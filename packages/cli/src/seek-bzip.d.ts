declare module 'seek-bzip' {
  interface SeekBzip {
    decode(input: Buffer): Buffer;
  }

  const seekBzip: SeekBzip;
  export = seekBzip;
}
