// The slice of pngjs the e2e tests use to make test images (the package ships no types).
declare module 'pngjs' {
  export class PNG {
    constructor(options: { width: number; height: number });
    data: Buffer;
    static sync: { write(png: PNG): Buffer };
  }
}
