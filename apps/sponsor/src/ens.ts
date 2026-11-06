// The live ENSv2 deployment on Sepolia (docs.ens.domains/learn/deployments).
// ABIs are the verified ones from Sourcify; they differ from contracts-v2 main.
import { Contract, Interface, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import UserRegistryAbi from './abi/UserRegistry.json';
import PermissionedResolverAbi from './abi/PermissionedResolver.json';
import ETHRegistryAbi from './abi/ETHRegistry.json';

export const A = {
  ETH_REGISTRY: '0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4',
  ETH_REGISTRAR: '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3',
  UNIVERSAL_RESOLVER_PROXY: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe',
  RESOLVER_IMPL: '0x115eb53f0c60696633855f90b138178fb40b2b2c',
  FACTORY: '0xda70306c98e97ece36f997a21368e53298572991',
  USER_REGISTRY_IMPL: '0x9bd8a88719068d09ecee662f36c0e3856708366a',
  USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
} as const;

/** ENSIP-5 service key for a RAILGUN 0zk address. Matches the Ender wallet. */
export const TEXT_KEY = 'org.railgun';
export const FOREVER = (1n << 64n) - 1n;
export const ZERO = '0x0000000000000000000000000000000000000000';

export const R = {
  REGISTRAR: 1n << 0n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
};
export const adm = (r: bigint) => r << 128n;
export const RESOLVER_ALL = [0, 4, 8, 12, 16, 20, 24, 28, 120, 124].reduce(
  (m, b) => m | (1n << BigInt(b)) | (1n << BigInt(b + 128)),
  0n,
);
/** What a user gets on their own subname: everything but the sponsor's registrar power. */
export const USER_ROLES =
  R.SET_RESOLVER | adm(R.SET_RESOLVER) | R.SET_SUBREGISTRY | adm(R.SET_SUBREGISTRY) | R.RENEW | adm(R.RENEW) |
  R.UNREGISTER | adm(R.UNREGISTER) | R.CAN_TRANSFER_ADMIN;

export const registryIface = new Interface(UserRegistryAbi);
export const resolverIface = new Interface(PermissionedResolverAbi);
export const labelId = (label: string) => BigInt(keccak256(toUtf8Bytes(label)));

export const connect = () => {
  const key = process.env.SPONSOR_KEY;
  if (!key) throw new Error('SPONSOR_KEY is not set (apps/sponsor/.env)');
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com', 11155111, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  const sponsor = new Wallet(key, provider);
  return {
    provider,
    sponsor,
    registrar: new Contract(
      A.ETH_REGISTRAR,
      [
        'function commit(bytes32)',
        'function isAvailable(string) view returns (bool)',
        'function MIN_COMMITMENT_AGE() view returns (uint64)',
        'function makeCommitment(string,address,bytes32,address,address,uint64,bytes32) pure returns (bytes32)',
        'function getRegisterPrice(string,uint64,address) view returns (uint256 base, uint256 premium)',
        'function register(string,address,bytes32,address,address,uint64,address,bytes32) returns (uint256)',
      ],
      sponsor,
    ),
    ethRegistry: new Contract(A.ETH_REGISTRY, ETHRegistryAbi, sponsor),
    factory: new Contract(
      A.FACTORY,
      ['function deployProxy(address,uint256,bytes) returns (address)', 'function predictProxyAddress(address,uint256) view returns (address)'],
      sponsor,
    ),
    usdc: new Contract(A.USDC, ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], sponsor),
    userRegistryAt: (addr: string) => new Contract(addr, UserRegistryAbi, sponsor),
    resolverAt: (addr: string) => new Contract(addr, PermissionedResolverAbi, sponsor),
  };
};
