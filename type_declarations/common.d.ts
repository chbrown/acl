interface ErrorCallback { (error?: Error): void; }
// type ErrorCallback = (error?: Error) => void; // doesn't play nicely with previously declared ErrorCallback type
interface ErrorResultCallback<T> { (err?: Error, result?: T): void }

interface StringMap { [index: string]: string; }
