declare module "domlike/handler" {
  // TODO: figure out why importing this from another file doesn't work if s/class/interface/
  class DomlikeHandler {
    constructor(callback: (err: Error, document: any) => void);
  }
  export = DomlikeHandler;
}
