import { escrowContract, indexerUrl } from "./contracts";
import axios from "axios";

export type EscrowEntry = {
    active: boolean,
    value: number
};

// Query indexer for value currently in escrow (if any).
export const getPendingAmount = async (walletAddress: string) => {
    try {
        const ledgerQuery = indexerUrl + escrowContract + "/bigmaps/m/keys?select=active,value&key=" + walletAddress;
        const response = await axios.get(ledgerQuery);
        const entry: EscrowEntry = response.data[0];
        return entry.active ? entry.value : 0;
    } catch (error) {
        //console.log(error);
    }
    return 0;
};

