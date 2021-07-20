import {network, ethers, run} from 'hardhat';
import {TransactionResponse} from '@ethersproject/abstract-provider';
import {NetworkConfig} from './config';
import {
  FetchTokenBalances,
  SmartWalletImplementation,
  SmartWalletProxy,
  UniSwap,
  CompoundLending,
  UniSwapV3,
  KyberProxy,
  KyberDmm,
  AaveV1Lending,
  AaveV2Lending,
  FetchAaveDataWrapper,
} from '../typechain';
import {Contract} from '@ethersproject/contracts';
import {IAaveV2Config} from './config_utils';
import {sleep, zeroAddress} from '../test/helper';
import {BigNumber, PopulatedTransaction} from 'ethers';
import {TransactionRequest} from '@ethersproject/abstract-provider';
import {multisig} from '../hardhat.config';
import EthersSafe from '@gnosis.pm/safe-core-sdk';
import {OperationType} from '@gnosis.pm/safe-core-sdk-types';

const gasLimit = 700000;

const networkConfig = NetworkConfig[network.name];
if (!networkConfig) {
  throw new Error(`Missing deploy config for ${network.name}`);
}

export interface KrystalContracts {
  smartWalletImplementation: SmartWalletImplementation;
  smartWalletProxy: SmartWalletProxy;
  fetchTokenBalances: FetchTokenBalances;
  fetchAaveDataWrapper: FetchAaveDataWrapper;
  swapContracts: {
    uniSwap?: UniSwap;
    uniSwapV3?: UniSwapV3;
    kyberProxy?: KyberProxy;
    kyberDmm?: KyberDmm;
  };
  lendingContracts: {
    compoundLending?: CompoundLending;
    aaveV1?: AaveV1Lending;
    aaveV2?: AaveV2Lending;
    aaveAMM?: AaveV2Lending;
  };
}

export const deploy = async (
  existingContract: Record<string, any> | undefined = undefined,
  extraArgs: {from?: string} = {}
): Promise<KrystalContracts> => {
  const [deployer] = await ethers.getSigners();

  const deployerAddress = await deployer.getAddress();

  log(0, 'Start deploying Krystal contracts');
  log(0, '======================\n');
  let deployedContracts = await deployContracts(existingContract, multisig || deployerAddress);

  // Initialization
  log(0, 'Updating proxy data');
  log(0, '======================\n');
  await updateProxy(deployedContracts, extraArgs);

  log(0, 'Updating swaps/lendings linking');
  log(0, '======================\n');
  await updateChildContracts(deployedContracts, extraArgs);

  log(0, 'Updating uniswap/clones config');
  log(0, '======================\n');
  await updateUniSwap(deployedContracts.swapContracts.uniSwap, extraArgs);

  log(0, 'Updating uniswapV3/clones config');
  log(0, '======================\n');
  await updateUniSwapV3(deployedContracts.swapContracts.uniSwapV3, extraArgs);

  log(0, 'Updating kyberProxy config');
  log(0, '======================\n');
  await updateKyberProxy(deployedContracts.swapContracts.kyberProxy, extraArgs);

  log(0, 'Updating kyberDmm config');
  log(0, '======================\n');
  await updateKyberDmm(deployedContracts.swapContracts.kyberDmm, extraArgs);

  log(0, 'Updating compound/clones config');
  log(0, '======================\n');
  await updateCompoundLending(deployedContracts.lendingContracts.compoundLending, extraArgs);

  log(0, 'Updating aave V1 config');
  log(0, '======================\n');
  await updateAaveV1Lending(deployedContracts.lendingContracts.aaveV1, extraArgs);

  log(0, 'Updating aave V2 config');
  log(0, '======================\n');
  await updateAaveV2Lending(deployedContracts.lendingContracts.aaveV2, networkConfig.aaveV2, extraArgs);

  log(0, 'Updating aave AMM config');
  log(0, '======================\n');
  await updateAaveV2Lending(deployedContracts.lendingContracts.aaveAMM, networkConfig.aaveAMM, extraArgs);

  // Summary
  log(0, 'Summary');
  log(0, '=======\n');

  log(0, JSON.stringify(convertToAddressObject(deployedContracts), null, 2));

  console.log('\nDeployment complete!');
  return deployedContracts;
};

async function deployContracts(
  existingContract: Record<string, any> | undefined = undefined,
  contractAdmin: string
): Promise<KrystalContracts> {
  let step = 0;

  const smartWalletImplementation = (await deployContract(
    ++step,
    networkConfig.autoVerifyContract,
    'SmartWalletImplementation',
    existingContract?.['smartWalletImplementation'],
    contractAdmin
  )) as SmartWalletImplementation;

  const fetchTokenBalances = (await deployContract(
    ++step,
    networkConfig.autoVerifyContract,
    'FetchTokenBalances',
    existingContract?.['fetchTokenBalances'],
    contractAdmin
  )) as FetchTokenBalances;

  const fetchAaveDataWrapper = (await deployContract(
    ++step,
    networkConfig.autoVerifyContract,
    'FetchAaveDataWrapper',
    existingContract?.['fetchAaveDataWrapper'],
    contractAdmin
  )) as FetchAaveDataWrapper;

  const swapContracts = {
    uniSwap: !networkConfig.uniswap
      ? undefined
      : ((await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'UniSwap',
          existingContract?.['swapContracts']?.['uniSwap'],
          contractAdmin,
          networkConfig.uniswap.routers
        )) as UniSwap),
    uniSwapV3: !networkConfig.uniswapV3
      ? undefined
      : ((await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'UniSwapV3',
          existingContract?.['swapContracts']?.['uniSwapV3'],
          contractAdmin,
          networkConfig.uniswapV3.routers
        )) as UniSwapV3),
    kyberProxy: !networkConfig.kyberProxy
      ? undefined
      : ((await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'KyberProxy',
          existingContract?.['swapContracts']?.['kyberProxy'],
          contractAdmin,
          networkConfig.kyberProxy.proxy
        )) as KyberProxy),
    kyberDmm: !networkConfig.kyberDmm
      ? undefined
      : ((await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'KyberDmm',
          existingContract?.['swapContracts']?.['kyberDmm'],
          contractAdmin,
          networkConfig.kyberDmm.router
        )) as KyberDmm),
  };

  const lendingContracts = {
    compoundLending: (!networkConfig.compound
      ? undefined
      : await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'CompoundLending',
          existingContract?.['lendingContracts']?.['compoundLending'],
          contractAdmin
        )) as CompoundLending,

    aaveV1: (!networkConfig.aaveV1
      ? undefined
      : await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'AaveV1Lending',
          existingContract?.['lendingContracts']?.['aaveV1Lending'],
          contractAdmin
        )) as AaveV1Lending,

    aaveV2: (!networkConfig.aaveV2
      ? undefined
      : await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'AaveV2Lending',
          existingContract?.['lendingContracts']?.['aaveV2Lending'],
          contractAdmin
        )) as AaveV2Lending,

    aaveAMM: (!networkConfig.aaveAMM
      ? undefined
      : await deployContract(
          ++step,
          networkConfig.autoVerifyContract,
          'AaveV2Lending',
          existingContract?.['lendingContracts']?.['aaveAMMLending'],
          contractAdmin
        )) as AaveV2Lending,
  };

  const smartWalletProxy = (await deployContract(
    ++step,
    networkConfig.autoVerifyContract,
    'SmartWalletProxy',
    existingContract?.['smartWalletProxy'],
    contractAdmin,
    smartWalletImplementation.address,
    networkConfig.supportedWallets,
    Object.values(swapContracts)
      .filter((c) => c)
      .map((c?: Contract) => c!.address),
    Object.values(lendingContracts)
      .filter((c) => c)
      .map((c: Contract) => c.address)
  )) as SmartWalletProxy;

  return {
    smartWalletImplementation,
    smartWalletProxy,
    fetchTokenBalances,
    fetchAaveDataWrapper,
    swapContracts,
    lendingContracts,
  };
}

async function deployContract(
  step: number,
  autoVerify: boolean,
  contractName: string,
  contractAddress: string | undefined,
  ...args: any[]
): Promise<Contract> {
  log(1, `${step}. Deploying '${contractName}'`);
  log(1, '------------------------------------');

  const factory = await ethers.getContractFactory(contractName);

  if (contractAddress) {
    log(2, `> contract already exists`);
    log(2, `> address:\t${contractAddress}`);
    return factory.attach(contractAddress);
  }

  const contract = await factory.deploy(...args);
  const tx = await contract.deployed();
  await printInfo(tx.deployTransaction);
  log(2, `> address:\t${contract.address}`);

  if (autoVerify) {
    try {
      log(3, '>> sleep first, wait for contract data to be propagated');
      await sleep(10000);
      log(3, '>> start verifying');
      await run('verify:verify', {
        address: contract.address,
        constructorArguments: args,
      });
      log(3, '>> done verifying');
    } catch (e) {
      log(2, 'failed to verify contract', e);
    }
  }

  return contract;
}

async function updateProxy(
  {smartWalletProxy, smartWalletImplementation, swapContracts, lendingContracts}: KrystalContracts,
  extraArgs: {from?: string}
) {
  log(1, 'Update impl contract');
  let currentImpl = await smartWalletProxy.implementation();
  if (currentImpl === smartWalletImplementation.address) {
    log(2, `Impl contract is already up-to-date at ${smartWalletImplementation.address}`);
  } else {
    const tx = await executeTxn(
      await smartWalletProxy.populateTransaction.updateNewImplementation(smartWalletImplementation.address, {
        gasLimit,
        ...extraArgs,
      })
    );
    await printInfo(tx);
  }

  log(1, 'update supported platform wallets');
  let existing = (await smartWalletProxy.getAllSupportedPlatformWallets()).map((r) => r.toLowerCase());
  let configWallets = networkConfig.supportedWallets.map((r) => r.toLowerCase());
  let toBeRemoved = existing.filter((add) => !configWallets.includes(add));
  let toBeAdded = configWallets.filter((add) => !existing.includes(add));
  await updateAddressSet(
    smartWalletProxy.populateTransaction.updateSupportedPlatformWallets,
    toBeRemoved,
    toBeAdded,
    extraArgs
  );

  log(1, 'update supported swaps');
  existing = (await smartWalletProxy.getAllSupportedSwaps()).map((r) => r.toLowerCase());
  let swaps: string[] = Object.values(swapContracts)
    .filter((c) => c)
    .map((c) => c!.address.toLowerCase());
  toBeRemoved = existing.filter((add) => !swaps.includes(add));
  toBeAdded = swaps.filter((add) => !existing.includes(add));
  await updateAddressSet(smartWalletProxy.populateTransaction.updateSupportedSwaps, toBeRemoved, toBeAdded, extraArgs);

  log(1, 'update supported lendings');
  existing = (await smartWalletProxy.getAllSupportedLendings()).map((r) => r.toLowerCase());
  let lendings: string[] = Object.values(lendingContracts)
    .filter((c) => c)
    .map((c) => c!.address.toLowerCase());
  toBeRemoved = existing.filter((add) => !lendings.includes(add));
  toBeAdded = lendings.filter((add) => !existing.includes(add));
  await updateAddressSet(
    smartWalletProxy.populateTransaction.updateSupportedLendings,
    toBeRemoved,
    toBeAdded,
    extraArgs
  );
}

async function updateChildContracts(
  {smartWalletProxy, swapContracts, lendingContracts}: KrystalContracts,
  extraArgs: {from?: string}
) {
  log(1, 'Linking swap contracts to proxy');
  let merged = {...swapContracts, ...lendingContracts};
  for (let contractName in merged) {
    // @ts-ignore maping to UniSwap to get function list
    let contract: UniSwap | undefined = merged[contractName];
    if (contract) {
      log(2, `Updating ${contractName} ${contract.address}`);
      if ((await contract.proxyContract()).toLowerCase() == smartWalletProxy.address.toLowerCase()) {
        log(2, `> Proxy contract is already up-to-date at ${smartWalletProxy.address}`);
      } else {
        const tx = await executeTxn(
          await contract.populateTransaction.updateProxyContract(smartWalletProxy.address, {
            gasLimit,
            ...extraArgs,
          })
        );
        log(2, `> Linking to proxy ${smartWalletProxy.address}`);
        await printInfo(tx);
      }
    }
  }
}

async function updateUniSwap(uniSwap: UniSwap | undefined, extraArgs: {from?: string}) {
  if (!uniSwap || !networkConfig.uniswap) {
    log(1, 'protocol not supported on this env');
    return;
  }
  log(1, 'update supported routers');
  let existing = (await uniSwap.getAllUniRouters()).map((r) => r.toLowerCase());
  let configRouters = networkConfig.uniswap!.routers.map((r) => r.toLowerCase());
  let toBeRemoved = existing.filter((add) => !configRouters.includes(add));
  let toBeAdded = configRouters.filter((add) => !existing.includes(add));
  await updateAddressSet(uniSwap.populateTransaction.updateUniRouters, toBeRemoved, toBeAdded, extraArgs);
}

async function updateUniSwapV3(uniSwapV3: UniSwapV3 | undefined, extraArgs: {from?: string}) {
  if (!uniSwapV3 || !networkConfig.uniswapV3) {
    log(1, 'protocol not supported on this env');
    return;
  }
  log(1, 'update supported routers');
  let existing = (await uniSwapV3.getAllUniRouters()).map((r) => r.toLowerCase());
  let configRouters = networkConfig.uniswapV3!.routers.map((r) => r.toLowerCase());
  let toBeRemoved = existing.filter((add) => !configRouters.includes(add));
  let toBeAdded = configRouters.filter((add) => !existing.includes(add));
  await updateAddressSet(uniSwapV3.populateTransaction.updateUniRouters, toBeRemoved, toBeAdded, extraArgs);
}

async function updateKyberProxy(kyberProxy: KyberProxy | undefined, extraArgs: {from?: string}) {
  if (!kyberProxy || !networkConfig.kyberProxy) {
    log(1, 'protocol not supported on this env');
    return;
  }
  log(1, 'update proxy');

  if ((await kyberProxy.kyberProxy()).toLowerCase() === networkConfig.kyberProxy.proxy.toLowerCase()) {
    log(2, `kyberProxy already up-to-date at ${networkConfig.kyberProxy.proxy}`);
  } else {
    const tx = await executeTxn(await kyberProxy.populateTransaction.updateKyberProxy(networkConfig.kyberProxy.proxy));
    log(2, '> updated kyberProxy', JSON.stringify(networkConfig.kyberProxy, null, 2));
    await printInfo(tx);
  }
}

async function updateKyberDmm(kyberDmm: KyberDmm | undefined, extraArgs: {from?: string}) {
  if (!kyberDmm || !networkConfig.kyberDmm) {
    log(1, 'protocol not supported on this env');
    return;
  }
  log(1, 'update proxy');

  if ((await kyberDmm.dmmRouter()).toLowerCase() === networkConfig.kyberDmm.router.toLowerCase()) {
    log(2, `dmmRouter already up-to-date at ${networkConfig.kyberDmm.router}`);
  } else {
    const tx = await executeTxn(await kyberDmm.populateTransaction.updateDmmRouter(networkConfig.kyberDmm.router));
    log(2, '> updated dmmRouter', JSON.stringify(networkConfig.kyberDmm, null, 2));
    await printInfo(tx);
  }
}

async function updateCompoundLending(compoundLending: CompoundLending | undefined, extraArgs: {from?: string}) {
  if (!compoundLending || !networkConfig.compound) {
    log(1, 'protocol not supported on this env');
    return;
  }

  log(1, 'update compound data');
  let compoundData = await compoundLending.compoundData();
  // comptroller is at the first 20 bytes
  let currentComptroller = '0x' + compoundData.slice(2, 40);
  if (currentComptroller === networkConfig.compound.compTroller) {
    log(2, `comptroller already up-to-date at ${networkConfig.compound.compTroller}`);
  } else {
    const tx = await executeTxn(
      await compoundLending.populateTransaction.updateCompoundData(
        networkConfig.compound.compTroller,
        networkConfig.compound.cNative,
        networkConfig.compound.cTokens
      )
    );
    log(2, '> updated compound', JSON.stringify(networkConfig.compound, null, 2));
    await printInfo(tx);
  }
}

async function updateAaveV1Lending(aaveV1Lending: AaveV1Lending | undefined, extraArgs: {from?: string}) {
  if (!aaveV1Lending || !networkConfig.aaveV1) {
    log(1, 'protocol not supported on this env');
    return;
  }

  log(1, 'update aave v1 data');
  const tx = await executeTxn(
    await aaveV1Lending.populateTransaction.updateAaveData(
      networkConfig.aaveV1.poolV1,
      networkConfig.aaveV1.poolCoreV1,
      networkConfig.aaveV1.referralCode,
      networkConfig.aaveV1.tokens
    )
  );
  log(2, '> updated aave v1', JSON.stringify(networkConfig.aaveV1, null, 2));
  await printInfo(tx);
}

async function updateAaveV2Lending(
  aaveV2Lending: AaveV2Lending | undefined,
  aaveV2Config: IAaveV2Config | undefined,
  _extraArgs: {from?: string}
) {
  if (!aaveV2Lending || !aaveV2Config) {
    log(1, 'protocol not supported on this env');
    return;
  }

  log(1, 'update aave v2 data');
  const tx = await executeTxn(
    await aaveV2Lending.populateTransaction.updateAaveData(
      aaveV2Config.provider,
      aaveV2Config.poolV2,
      aaveV2Config.referralCode,
      aaveV2Config.weth,
      aaveV2Config.tokens
    )
  );
  log(2, '> updated aave v2', JSON.stringify(networkConfig.aaveV2, null, 2));
  await printInfo(tx);
}

async function updateAddressSet(
  populateFunc: any,
  toBeRemoved: string[],
  toBeAdded: string[],
  extraArgs: {from?: string}
) {
  if (toBeRemoved.length) {
    const tx = await executeTxn(
      await populateFunc(toBeRemoved, false, {
        gasLimit,
        ...extraArgs,
      })
    );
    log(2, '> removed wallets', toBeRemoved);
    await printInfo(tx);
  } else {
    log(2, '> nothing to be removed');
  }
  console.log('\n');
  if (toBeAdded.length) {
    const tx = await executeTxn(
      await populateFunc(toBeAdded, true, {
        gasLimit,
        ...extraArgs,
      })
    );
    log(2, '> added wallets', toBeAdded);
    await printInfo(tx);
  } else {
    log(2, '> nothing to be added');
  }
}

async function printInfo(tx: TransactionResponse) {
  const receipt = await tx.wait(1);

  log(2, `> tx hash:\t${tx.hash}`);
  log(2, `> gas price:\t${tx.gasPrice.toString()}`);
  log(2, `> gas used:\t${receipt.gasUsed.toString()}`);
}

export function convertToAddressObject(obj: Record<string, any> | Array<any> | Contract): any {
  if (obj === undefined) return obj;
  if (obj instanceof Contract) {
    return obj.address;
  } else if (Array.isArray(obj)) {
    return obj.map((k) => convertToAddressObject(obj[k]));
  } else {
    let ret = {};
    for (let k in obj) {
      // @ts-ignore
      ret[k] = convertToAddressObject(obj[k]);
    }
    return ret;
  }
}

let prevLevel: number;
function log(level: number, ...args: any[]) {
  if (prevLevel != undefined && prevLevel > level) {
    console.log('\n');
  }
  prevLevel = level;

  let prefix = '';
  for (let i = 0; i < level; i++) {
    prefix += '    ';
  }
  console.log(`${prefix}`, ...args);
}

async function executeTxn(txn: TransactionRequest | PopulatedTransaction): Promise<TransactionResponse> {
  let tx;

  if (multisig) {
    const signer = (await ethers.getSigners())[0];
    const safeSdk = await EthersSafe.create({ethers, safeAddress: multisig, providerOrSigner: signer});
    const safeTransaction = await safeSdk.createTransaction({
      to: txn.to ?? zeroAddress,
      value: txn.value?.toString() ?? '0',
      data: txn.data!.toString(),
      operation: OperationType.Call,
    });
    tx = await safeSdk.executeTransaction(safeTransaction);
  } else {
    const signer = (await ethers.getSigners())[0];
    tx = await signer.sendTransaction(txn);
  }
  return tx;
}