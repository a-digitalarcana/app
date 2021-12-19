import { TezosToolkit, MichelCodecPacker } from "@taquito/taquito";
import { BeaconWallet } from "@taquito/beacon-wallet";
import { escrowContract, rpcUrl, network } from "./contracts";

export type EscrowEntry = {
    active: boolean,
    value: number
};

const Tezos = new TezosToolkit(rpcUrl);
const wallet = new BeaconWallet({
    name: "da-client (hangzhou)",
    preferredNetwork: network
});

Tezos.setWalletProvider(wallet);
Tezos.setPackerProvider(new MichelCodecPacker());

export const connectWallet = async() => {
    try {
        await wallet.requestPermissions({network: {type: network, rpcUrl}});
    } catch (error) {
        console.log(error);
        return error;
    }
};

// Get address to use for purchases.
export const getWalletAddress = async() => {
    const activeAccount = await wallet.client.getActiveAccount();
    if (activeAccount) {
        return activeAccount.address;
    }

    await wallet.requestPermissions({network: {type: network, rpcUrl}});
    return await wallet.getPKH();
};

// TODO: Check sold out status before sending funds.
export const buyPack = async () => {
    try {
        const address = await getWalletAddress();
        console.log(`Buy pack: ${address}`);

        // Send money to escrow contract.
        const contract = await Tezos.wallet.at(escrowContract);
        const op = await contract.methods.add_funds().send({amount: 1});
        console.log('Operation hash:', op.opHash);
        await op.confirmation();
        console.log("Confirmed!");
        return true;
    
    } catch (error) {
        console.log(error);
    }
    return false;
};

export const refundPack = async() => {
    try {
        const address = await getWalletAddress();
        console.log(`Refund pack: ${address}`);

        // Retrieve money from escrow contract.
        const contract = await Tezos.wallet.at(escrowContract);
        const op = await contract.methods.pull_funds().send();
        console.log('Operation hash:', op.opHash);
        await op.confirmation();
        console.log("Confirmed!");
        return true;
    
    } catch (error) {
        console.log(error);
    }
    return false;
};