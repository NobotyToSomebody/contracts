import  {ethers,upgrades} from "hardhat";
import { ExecutorMsg } from '@bnb-chain/bsc-cross-greenfield-sdk';
import { Policy } from '@bnb-chain/greenfield-cosmos-types/greenfield/permission/types';
import { Client } from '@bnb-chain/greenfield-js-sdk';
import { ResourceType } from '@bnb-chain/greenfield-cosmos-types/greenfield/resource/types';
import {BucketRegistry__factory} from  "../typechain-types/factories/contracts";
import {BucketFactory__factory} from  "../typechain-types/factories/contracts/BucketFactory.sol";
import {BucketManager__factory} from  "../typechain-types/factories/contracts/BucketManager.sol";

import {
   ActionType,
   Effect,
   PrincipalType,
} from '@bnb-chain/greenfield-cosmos-types/greenfield/permission/common';
import { Passport__factory } from "../typechain-types";

const callbackGasLimit = 200000n
const failureHandleStrategy = 2

//bsc testnet
const TOKEN_HUB = "0xED8e5C546F84442219A5a987EE1D820698528E04";
const CROSS_CHAIN = "0xa5B2c9194131A4E0BFaCbF9E5D6722c873159cb7";
const BUCKET_HUB = "0x5BB17A87D03620b313C39C24029C94cB5714814A";
const PERMISSION_HUB = "0x25E1eeDb5CaBf288210B132321FBB2d90b4174ad";
const SP_ADDRESS_TESTNET = "0x1eb29708f59f23fe33d6f1cd3d54f07636ff466a";
const GREENFIELD_EXECUTOR = "0x3E3180883308e8B4946C9a485F8d91F8b15dC48e";

//bsc mainnet
// const TOKEN_HUB = "0xeA97dF87E6c7F68C9f95A69dA79E19B834823F25";
// const CROSS_CHAIN = "0x77e719b714be09F70D484AB81F70D02B0E182f7d";
// const BUCKET_HUB = "0xE909754263572F71bc6aFAc837646A93f5818573";
// const PERMISSION_HUB = "0xe1776006dBE9B60d9eA38C0dDb80b41f2657acE8";
// const SP_ADDRESS_TESTNET = "0x51dbbf9b3f02b4471c0bf5f7d1fa7bc86242138c";
// const GREENFIELD_EXECUTOR = "0xFa39D9111D927836b14D071d43e0aAD9cE83bBBf";
// const SCHEMA_REGISTRY = "0x5e905F77f59491F03eBB78c204986aaDEB0C6bDa"

async function buyBucket(_passport:string,value:bigint) {
    const [signer] = await ethers.getSigners();
    const passport = Passport__factory.connect(_passport,signer)
    const resp = await passport.buyBucketManager({value});
    await resp.wait()
    console.log(`buy bucket manager in tx ${resp.hash}`);
}

async function deployPassport(fee: bigint, bucketRegistry:string) {
    const [signer] = await ethers.getSigners();
    console.log('Deploy passport contract with account:',signer.address);

    const Passport =  await ethers.getContractFactory("Passport",signer);
    const passport = await upgrades.deployProxy(Passport,[fee,bucketRegistry]);
    await passport.waitForDeployment();
    const addr = await passport.getAddress();
    console.log('Passport Address:', addr)
    return addr
}

async function deployRegistry() {
    const [signer] = await ethers.getSigners();
    console.log('Deploy bucket registry contract with account:',signer.address);

    const Registry =  await ethers.getContractFactory("BucketRegistry",signer);
    const registry = await upgrades.deployProxy(Registry,[]);
    await registry.waitForDeployment();
    const addr = await registry.getAddress();
    console.log('Bucket Registry Address:', addr)
    return addr
}

async function deployFactory(bucketRegistry: string) {
    const [signer] = await ethers.getSigners();
    const Factory =  await ethers.getContractFactory("BucketFactory",signer);

    const factory = await upgrades.deployProxy(Factory,[
        bucketRegistry,
        TOKEN_HUB,
        CROSS_CHAIN,
        BUCKET_HUB,
        PERMISSION_HUB,
        GREENFIELD_EXECUTOR,
    ])
    await factory.waitForDeployment()
    const addr = await factory.getAddress();
    console.log('Bucket Factory Address:', addr)
    return addr
}

async function setFactoryAddressForRegistry(_registry: string,_factory:string) {
    const [signer] = await ethers.getSigners();
    const registry = BucketRegistry__factory.connect(_registry,signer)
    const resp = await registry.setBucketFactory(_factory);
    await resp.wait()
    console.log(`set bucket factory address to ${_factory} in tx ${resp.hash}`);
}

 async function deployBucketManager(_factory: string,salt: string, _transferOutAmt: string) {
    const [signer] = await ethers.getSigners();
    
    const factory = BucketFactory__factory.connect(_factory,signer)

    const CROSS_CHAIN = await factory.cross_chain();
    const crossChain = (await ethers.getContractAt('ICrossChain', CROSS_CHAIN));
    const [relayFee, ackRelayFee] = await crossChain.getRelayFees();

    const transferOutAmt = ethers.parseEther(_transferOutAmt);
    const value = transferOutAmt + relayFee + ackRelayFee;
    if (transferOutAmt == 0n) {
        const resp = await factory.deploy(transferOutAmt,salt);
        await resp.wait();
        console.log(`create bucket manager contract in tx ${resp.hash}`);
    } else{
        const resp = await factory.deploy(transferOutAmt,salt,{value});
        await resp.wait();
        console.log(`create bucket manager contract in tx ${resp.hash}`);
    }


    const _bucketManager = await factory.getManagerAddress(salt);
    console.log("deploy manager:", _bucketManager)
    return _bucketManager
}

async function createBucket(_bucketManager: string, name: string) {
    const GRPC_URL = 'https://gnfd-testnet-fullnode-tendermint-us.bnbchain.org';
    const GREEN_CHAIN_ID = 'greenfield_5600-1';
    const client = Client.create(GRPC_URL, GREEN_CHAIN_ID);

    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)

    const CROSS_CHAIN = await bucketManager.cross_chain();
    const crossChain = (await ethers.getContractAt('ICrossChain', CROSS_CHAIN));
    const [relayFee, ackRelayFee] = await crossChain.getRelayFees();

    const gasPrice =  10_000_000_000n;
    const bucketName = await bucketManager.getName(name)

    const dataSetBucketFlowRateLimit = ExecutorMsg.getSetBucketFlowRateLimitParams({
        bucketName:bucketName,
        bucketOwner: _bucketManager,
        operator: _bucketManager,
        paymentAddress: _bucketManager,
        flowRateLimit: '100000000000000000',
    });

    const executorData = dataSetBucketFlowRateLimit[1];
    const value = 2n * relayFee + ackRelayFee + callbackGasLimit * gasPrice

    console.log('- create bucket', bucketName);
    console.log('send crosschain tx!');
    const resp1 = await (await bucketManager.createBucket(
        name,
        executorData, 
        callbackGasLimit,
        failureHandleStrategy,
        SP_ADDRESS_TESTNET,
        {value: value })).wait();
    console.log(`https://testnet.bscscan.com/tx/${resp1?.hash}`);

    console.log('waiting for bucket created..., about 1 minute');
    await sleep(60); // waiting bucket created

    const schemaBucketInfo = await client.bucket.getBucketMeta({ bucketName:bucketName });
    const schemaBucketId = schemaBucketInfo.body!.GfSpGetBucketMetaResponse.Bucket.BucketInfo.Id;

    console.log('bucket created, bucket id', schemaBucketId);
    const schemaHexBucketId = `0x000000000000000000000000000000000000000000000000000000000000${BigInt(
        schemaBucketId
    ).toString(16)}`;
    console.log(`https://testnet.greenfieldscan.com/bucket/${schemaHexBucketId}`);
}


async function getBucketStatus(_bucketManager: string, name: string) {
    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)
    const status = await bucketManager.getBucketStatus(name)
    const bucketName = await bucketManager.getName(name)
    console.log(`Status of bucket ${bucketName} is ${status}`)
    return status
}

async function getBucketId(_bucketManager: string,_registry: string,name: string) {
    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)
    const userBucketName = await bucketManager.getName(name);
    const registry = BucketRegistry__factory.connect(_registry,signer)

    const id = await registry.bucketsNames(userBucketName)
    console.log(`ID of bucket ${userBucketName} is ${id}`)
}

async function createPolicy(_bucketManager: string ,eoa : string, name: string) {
    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)

    const GRPC_URL = 'https://gnfd-testnet-fullnode-tendermint-us.bnbchain.org';
    const GREEN_CHAIN_ID = 'greenfield_5600-1';
    const client = Client.create(GRPC_URL, GREEN_CHAIN_ID);
     
    const bucketName = await bucketManager.getName(name);
    const bucketInfo = await client.bucket.getBucketMeta({ bucketName });
    const bucketId = bucketInfo.body!.GfSpGetBucketMetaResponse.Bucket.BucketInfo.Id;

    const CROSS_CHAIN = await bucketManager.cross_chain();
    const crossChain = (await ethers.getContractAt('ICrossChain', CROSS_CHAIN));
    const [relayFee, ackRelayFee] = await crossChain.getRelayFees();

    const gasPrice =  10_000_000_000n;
    const value = relayFee + ackRelayFee + callbackGasLimit * gasPrice

    const policyDataToAllowUserOperateBucket = Policy.
     encode({
        id: '0',
        resourceId: bucketId, 
        resourceType: ResourceType.RESOURCE_TYPE_BUCKET,
        statements: [
            {
                effect: Effect.EFFECT_ALLOW,
                actions: [
                    ActionType.ACTION_CREATE_OBJECT,
                    ActionType.ACTION_GET_OBJECT,
                    ActionType.ACTION_LIST_OBJECT
                ], 
                resources: [],
            },
        ],
        principal: {
            type: PrincipalType.PRINCIPAL_TYPE_GNFD_ACCOUNT,
            value: eoa,
        },
    }).finish();

    const resp =  await bucketManager.createPolicy(
        name,
        policyDataToAllowUserOperateBucket,
        callbackGasLimit,
        failureHandleStrategy,
        {value})
    console.log(`https://testnet.bscscan.com/tx/${resp?.hash}`);

    console.log(
        `policy set success, ${eoa} could create object ${bucketName} (id: ${bucketId}) now on Greenfield`
    );
    return ethers.keccak256(policyDataToAllowUserOperateBucket)
}

async function getPolicyStatus(_bucketManager: string, _hash :string) {
    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)

    const status = await bucketManager.getPolicyStatus(_hash)
    console.log(`Status of Policy ${_hash} is ${status}`)
    return status
}


async function sleep(seconds: number) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function getControlledManagers(_registry: string, controller: string) {
    const [signer] = await ethers.getSigners();
    const registry = BucketRegistry__factory.connect(_registry,signer)

    const managers = await registry.getBucketManagers(controller)
    console.log(`Bucket Managers of ${controller} are ${managers}`)

    const registeredManagers = await registry.getRegisteredManagers()
    console.log(`Bucket Managers registered are ${registeredManagers}`)
}

async function topUpBNB(_bucketManager:string) {
    const GRPC_URL = 'https://gnfd-testnet-fullnode-tendermint-us.bnbchain.org';
    const GREEN_CHAIN_ID = 'greenfield_5600-1';
    const client = Client.create(GRPC_URL, GREEN_CHAIN_ID);

    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)

    const CROSS_CHAIN = await bucketManager.cross_chain();
    const crossChain = (await ethers.getContractAt('ICrossChain', CROSS_CHAIN));

    console.log(`cross chain ${CROSS_CHAIN}`)
    const [relayFee, ackRelayFee] = await crossChain.getRelayFees();


    const tokenHub = await bucketManager.tokenHub()
    console.log(`token hub ${tokenHub}`)


    const value = relayFee + ackRelayFee  + 100n
    const status = await bucketManager.topUpBNB(100,{value})
    console.log(`top up is at tx ${status}`)
}

async function transferOwnership(_bucketManager:string, to : string){
    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)
    const resp = await bucketManager.transferOwnership(to)
    resp.wait()
    console.log(`transfer ownership to ${to} at tx ${resp.hash}`)
}

async function hashPolicy(_bucketManager: string, eoa:string, name:string) {
    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)
    const GRPC_URL = 'https://gnfd-testnet-fullnode-tendermint-us.bnbchain.org';
    const GREEN_CHAIN_ID = 'greenfield_5600-1';
    const client = Client.create(GRPC_URL, GREEN_CHAIN_ID);
     
    const bucketName = await bucketManager.getName(name);
    const bucketInfo = await client.bucket.getBucketMeta({ bucketName });
    const bucketId = bucketInfo.body!.GfSpGetBucketMetaResponse.Bucket.BucketInfo.Id;

    const CROSS_CHAIN = await bucketManager.cross_chain();
    const crossChain = (await ethers.getContractAt('ICrossChain', CROSS_CHAIN));
    const [relayFee, ackRelayFee] = await crossChain.getRelayFees();

    const gasPrice =  10_000_000_000n;
    const value = relayFee + ackRelayFee + callbackGasLimit * gasPrice

    const policyDataToAllowUserOperateBucket = Policy.
     encode({
        id: '0',
        resourceId: bucketId, 
        resourceType: ResourceType.RESOURCE_TYPE_BUCKET,
        statements: [
            {
                effect: Effect.EFFECT_ALLOW,
                actions: [
                    ActionType.ACTION_CREATE_OBJECT,
                    ActionType.ACTION_GET_OBJECT,
                    ActionType.ACTION_LIST_OBJECT
                ], 
                resources: [],
            },
        ],
        principal: {
            type: PrincipalType.PRINCIPAL_TYPE_GNFD_ACCOUNT,
            value: eoa,
        },
    }).finish();
    return ethers.keccak256(policyDataToAllowUserOperateBucket)
}

async function getManagerAmount(_registry:string, to:string) {
    const [signer] = await ethers.getSigners();
    const registry = BucketRegistry__factory.connect(_registry,signer)
    const amount = registry.controlledManagerAmount(to)
    return amount
}

async function ownership(_bucketManager:string) {
    const [signer] = await ethers.getSigners();
    const bucketManager = BucketManager__factory.connect(_bucketManager, signer)
    const owner = await bucketManager.owner()
    console.log(`ownership of manager ${_bucketManager} is ${owner}`)
}

async function upgradePassport(passportAddr:string) {
    const [signer] = await ethers.getSigners();
    const Passport =  await ethers.getContractFactory("Passport",signer);
    const resp = await upgrades.upgradeProxy(passportAddr, Passport)
    await resp.waitForDeployment()
}

async function main() {
    // const registry = await deployRegistry()
    // const factory = await deployFactory(registry)
    // await setFactoryAddressForRegistry(registry,factory)

    const registry = "0xF6cb5BB2bf7D79CA722E01D8d7B5550Bd2276442"
    const factory = "0x9f311097201260b95F3f6B49F525DeFf2C038174"

    const salt = ethers.hashMessage("12321")
    // const manager = await deployBucketManager(factory,salt,"0.001")
    const manager = "0x625c0590524f672F77df82CBF5Fdfc6396eE8e11"

    // await getControlledManagers(registry,"0x471543A3bd04486008c8a38c5C00543B73F1769e")

    // const passport = deployPassport(100n,registry)
    const passport = "0x184269c25d255bc4DB308A08882bE97d135777d8"


    const name = "nobody121212"  
    const eoa = '0x471543A3bd04486008c8a38c5C00543B73F1769e'

    // create bucket 
    // await createBucket(manager,name)
    // await getBucketStatus(manager,name)
    // await getBucketId(manager,registry,name)
    // await sleep(60)

    // create policy
    // const policyHash1 = await createPolicy(manager,eoa,name)
    // await getPolicyStatus(manager,policyHash1)

    // await transferOwnership(manager,passport)

    // await upgradePassport(passport)
    // await sleep(60)

    // await buyBucket(passport,100n)
    // await sleep(60)
    await ownership(manager)
}
  // We recommend this pattern to be able to use async/await everywhere
  // and properly handle errors.
  main().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });