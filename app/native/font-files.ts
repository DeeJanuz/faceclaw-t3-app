declare const com: any;
export function canLoadFontFile(path: string): boolean { try {return Boolean(com.faceclaw.app.FontFileRenderer.canLoadFont(path));} catch {return false;} }
export function fontFileDisplayName(path:string):{family:string;style:string}|null {try{const [family,style='']=String(com.faceclaw.app.FontFileRenderer.getFontName(path)||'').split('\n');return family?{family,style}:null;}catch{return null;}}
export function isFontFile(path: string): boolean {return /\.(ttf|otf)$/i.test(path);}
