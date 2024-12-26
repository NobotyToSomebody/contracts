// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
// import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";


interface IManager{
   function transferOwnership(address newOwner) external;
}

interface IBucketRegistry{
    function getBucketManagerAt(address controller, uint256 index)  external view returns (address);
    function controlledManagerAmount(address controller) external view returns (uint256);
}


contract Passport is Initializable, OwnableUpgradeable{
    using Address for address payable;

    uint256 public createBucketFee;
    uint256 public bank;

    IBucketRegistry public bucketRegistry;


    function initialize(uint256 _createBucketFee,IBucketRegistry _bucketRegistry) public initializer {
        __Ownable_init();

        createBucketFee = _createBucketFee;
        bucketRegistry = _bucketRegistry;

    }


    function setBucketFee(uint256 _createBucketFee) external onlyOwner {
        createBucketFee = _createBucketFee;
    }


    function withdraw(uint256 amount,address to) external onlyOwner(){
        if (amount > 0) {
            payable(to).sendValue(amount);
            bank-=amount;
        } else{
             payable(to).sendValue(bank);
             bank = 0;
        }
    } 

    function buyBucketManager() external payable {
        require(msg.value >= createBucketFee,"insufficient fund");
        bank += (msg.value);
        uint256 managerAmount = bucketRegistry.controlledManagerAmount(address(this));
        require(managerAmount != 0,"bucker has been sold out, try later again please");
        address manager = bucketRegistry.getBucketManagerAt(address(this), 0);
        IManager(manager).transferOwnership(msg.sender);
    }
}