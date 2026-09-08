export function spanCurrent<T>(_name: string, work: () => T): T {return work();}
