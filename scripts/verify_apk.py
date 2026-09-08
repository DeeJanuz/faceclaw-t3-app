#!/usr/bin/env python3
"""Fail closed on native ELF/ZIP alignment and optional local-release invariants."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile

PAGE_SIZE = 16384
MAX_LIBRARY_BYTES = 256 * 1024 * 1024


def build_tools(directory=None):
    if directory:
        result = Path(directory)
    else:
        sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if not sdk:
            raise ValueError("Set ANDROID_HOME or pass --build-tools")
        versions = [p for p in (Path(sdk) / "build-tools").iterdir()
                    if re.fullmatch(r"\d+\.\d+\.\d+", p.name)]
        versions = [p for p in versions if int(p.name.split(".")[0]) >= 35]
        if not versions:
            raise ValueError("Android SDK Build-Tools 35 or newer are required")
        result = max(versions, key=lambda p: tuple(map(int, p.name.split("."))))
    for name in ("zipalign", "apksigner", "aapt"):
        if not (result / name).is_file():
            raise ValueError(f"Missing Android build tool: {name}")
    return result


def elf_alignment(stream, size):
    """Read only ELF headers, never execute/extract APK content."""
    header = stream.read(64)
    if len(header) != 64 or header[:7] != b"\x7fELF\x02\x01\x01":
        raise ValueError("expected little-endian ELF64")
    fields = struct.unpack("<HHIQQQIHHHHHH", header[16:])
    kind, machine, version, _, phoff, _, _, ehsize, phsize, phnum, *_ = fields
    if kind != 3 or machine != 183 or version != 1 or ehsize != 64:
        raise ValueError("expected an Android arm64 shared library")
    if phsize != 56 or not 1 <= phnum <= 1024 or phoff < 64 or phoff + phsize * phnum > min(size, 1024 * 1024):
        raise ValueError("invalid ELF program-header bounds")
    stream.seek(phoff)
    table = stream.read(phsize * phnum)
    if len(table) != phsize * phnum:
        raise ValueError("truncated ELF program headers")
    loads = []
    relro = False
    for offset in range(0, len(table), phsize):
        segment, _, file_offset, virtual, _, file_size, memory_size, alignment = struct.unpack_from("<IIQQQQQQ", table, offset)
        if file_offset + file_size > size or file_size > memory_size:
            raise ValueError("invalid ELF segment bounds")
        if segment == 0x6474E552:
            relro = True
        if segment == 1:
            if alignment < PAGE_SIZE or alignment & (alignment - 1):
                raise ValueError(f"LOAD alignment 0x{alignment:x} is below 16 KB or invalid")
            if (virtual - file_offset) % alignment:
                raise ValueError("LOAD file/virtual addresses are not congruent")
            loads.append(alignment)
    if not loads or not relro:
        raise ValueError("missing LOAD or GNU_RELRO segment")
    return loads


def verify_native(apk):
    results = []
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate APK entries are not allowed")
        for entry in archive.infolist():
            if not entry.filename.endswith(".so"):
                continue
            if not re.fullmatch(r"lib/arm64-v8a/[^/]+\.so", entry.filename):
                raise ValueError(f"unexpected native library location: {entry.filename}")
            if entry.flag_bits & 1 or not 64 <= entry.file_size <= MAX_LIBRARY_BYTES:
                raise ValueError(f"invalid native library size/encryption: {entry.filename}")
            with archive.open(entry) as stream:
                try:
                    loads = elf_alignment(stream, entry.file_size)
                except ValueError as error:
                    raise ValueError(f"{entry.filename}: {error}") from error
            results.append((entry.filename, loads))
    if not results:
        raise ValueError("APK contains no arm64 native libraries")
    return results


def tool_output(args):
    result = subprocess.run(list(map(str, args)), capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f"{Path(args[0]).name} verification failed")
    return result.stdout


def verify(apk, tools, require_non_debuggable=False, expected_package=None, expected_cert=None):
    results = verify_native(apk)
    tool_output([tools / "zipalign", "-c", "-P", "16", "4", apk])
    signing = tool_output([tools / "apksigner", "verify", "--print-certs", apk])
    certs = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})", signing)
    if not certs or (expected_cert and (len(certs) != 1 or certs[0].lower() != expected_cert.lower())):
        raise ValueError("APK signing certificate does not match the verified installed app")
    manifest = tool_output([tools / "aapt", "dump", "badging", apk])
    package = re.search(r"^package: name='([^']+)'", manifest, re.MULTILINE)
    if not package or (expected_package and package[1] != expected_package):
        raise ValueError("APK package identifier mismatch")
    debuggable = bool(re.search(r"^application-debuggable(?:\s|$)", manifest, re.MULTILINE))
    if require_non_debuggable and debuggable:
        raise ValueError("APK is debuggable")
    for name, loads in results:
        print(f"PASS {name}: LOAD {','.join(hex(value) for value in loads)}, GNU_RELRO")
    print(f"PASS ZIP alignment: 16 KB; native libraries: {len(results)}")
    print(f"PASS package: {package[1]}; debuggable: {str(debuggable).lower()}")
    print(f"PASS signer SHA-256: {certs[0].lower()}")
    with open(apk, "rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    print(f"APK SHA-256: {digest}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--build-tools", type=Path)
    parser.add_argument("--require-non-debuggable", action="store_true")
    parser.add_argument("--expected-package")
    parser.add_argument("--expected-cert-sha256")
    args = parser.parse_args()
    try:
        verify(args.apk, build_tools(args.build_tools), args.require_non_debuggable,
               args.expected_package, args.expected_cert_sha256)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        print(f"APK verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
