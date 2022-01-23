import axios from "axios";
import { indexerUrl, fa2Contract } from "./contracts";
import { bytes2Char } from "@taquito/utils";
import { addOwned, clearOwned, registerCard } from "./cards";
import { totalCards } from "./tarot";
import { sendEvent } from "./connection";

type LedgerKey = {
    nat: string, // token_id
    address: string
};

type LedgerEntry = {
    key: LedgerKey,
    value: string, // amount
    active: boolean
};

type MetadataEntry = {
    token_id: string,
    token_info: any
};

const collectors: any = {};

export const collectCards = (walletAddress: string) => {
    if (collectors[walletAddress]) {
        return;
    }
    const collector = new CardCollector(walletAddress);
    collectors[walletAddress] = collector;
    collector.begin();
};

class CardCollector
{
    walletAddress: string;

    constructor(walletAddress: string) {
        this.walletAddress = walletAddress;
    }

    async begin() {

        clearOwned(this.walletAddress);

        // query the list of nft token_ids owned by this wallet address
        const bigmapQuery = indexerUrl + fa2Contract + "/bigmaps";
        const ledgerQuery = bigmapQuery + "/ledger/keys?select=key,value,active&key.address=" + this.walletAddress;
        const config = {headers: {'Content-Type': 'application/json'}};
        const { data } = await axios.get<LedgerEntry[]>(ledgerQuery, config);
        const active = data.filter(entry => entry.active);
        if (active.length > 0) {

            // store off amounts for easier lookup below
            const amounts = new Map<number, number>();
            for (let entry of active) {
                amounts.set(parseInt(entry.key.nat), parseInt(entry.value));
            }

            // query the metadata for each of the token_ids
            const token_ids = active.map(entry => entry.key.nat);
            let metadataQuery = bigmapQuery + "/token_metadata/keys?select=value&key";
            metadataQuery += (token_ids.length === 1) ? "=" : ".in=";
            metadataQuery += token_ids.join(",");
            const { data } = await axios.get<MetadataEntry[]>(metadataQuery, config);

            // register unique instances for number owned
            const promises = [];
            for (let entry of data) {
                const token_id = parseInt(entry.token_id);
                const ipfsUri = bytes2Char(entry.token_info['']);
                const amount = amounts.get(token_id);
                if (amount) {
                    for (let i = 0; i < amount; i++) {
                        promises.push(registerCard(token_id % totalCards, token_id, ipfsUri));
                    }
                    //console.log(`token_id=${entry.token_id} amount=${amount} metadata=${ipfsUri}`);
                } else {
                    console.log(`Invalid amount for token_id: ${entry.token_id}`);
                }
            }

            const cards = await Promise.all(promises);
            addOwned(this.walletAddress, cards);
            sendEvent(this.walletAddress, 'revealCards', cards);
        }
        else {
            console.log(`No owned cards for ${this.walletAddress}`);
        }

        // TODO: Register for changes to ledger to add/remove cards for this player.
    }
}