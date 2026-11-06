declare module 'level-js' {
  import type { AbstractLevelDOWN } from 'abstract-leveldown';
  const leveljs: (name: string) => AbstractLevelDOWN;
  export default leveljs;
}
declare module 'snarkjs' {
  export const groth16: {
    fullProve: (...args: unknown[]) => Promise<unknown>;
    verify: (...args: unknown[]) => Promise<boolean>;
  };
}
