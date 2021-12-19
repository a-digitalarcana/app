import { Socket } from "socket.io";
import { MongoClient, ReturnDocument } from "mongodb";
import { escrowContract, fa2Contract, indexerUrl, rpcUrl } from "./contracts";
import { EscrowEntry } from "./escrow";
import { TezosToolkit } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";
import { adminAddress } from "./admin";
import axios from "axios";

// Choose a random pack to transfer to purchaser.
export const openPack = async (socket: Socket, purchaserAddress: string, priceMutez: number, set: string, minting: string) => {
    const mongodb = require("../private/mongodb");
    const mongoClient = new MongoClient(mongodb.uri);
    try {
        const name = `${set} - ${minting}`;
        console.log(`Purchasing pack for ${purchaserAddress} from "${name}" set...`);
        console.log({purchaserAddress});

        // Verify funds available before sending transaction to avoid revealing cards on malicious attempts.
        const pendingAmount = async () => {
            try {
                const ledgerQuery = indexerUrl + escrowContract + "/bigmaps/m/keys?select=active,value&key=" + purchaserAddress;
                const response = await axios.get(ledgerQuery);
                const entry: EscrowEntry = response.data[0];
                return entry.active ? entry.value : 0;
            } catch (error) {
                //console.log(error)
            }
            return 0
        };
        const escrowAmount = await pendingAmount();
        if (escrowAmount != priceMutez) {
            throw `Invalid pending funds: ${escrowAmount} mutez`
        }

        // Give five minutes to finish purchase.
        const date = new Date();
        const now = date.getTime();
        date.setMinutes( date.getMinutes() - 5 );
        const expiry = date.getTime();

        // Connect to Mongo Atlas db.
        await mongoClient.connect();
        const db = mongoClient.db("packs");
        const collection = db.collection(name);

        // Try up to five times, in case someone else pick
        // the same pack before we can claim it.
        for (let attempts = 0; attempts < 5; attempts++) {

            // Pick a non-sold, non-pending pack at random.
            const query: any = {
                sold: null,
                $or: [ { pending: null }, { pending: { $lt: expiry } } ]
            };
            const results = await collection.aggregate([
                { $match: query },
                { $sample: { size: 1 } }
            ]).toArray();

            if (results.length === 0) {
                throw "Sold out!";
            }

            console.log(results[0]);

            // Mark it as pending.
            query._id = results[0]._id;
            let result = await collection.findOneAndUpdate(query,
                { $set: { pending: now } },
                { returnDocument: ReturnDocument.AFTER }
            );
/*
            // Simulate failed attempt.
            if ( attempts < 2 ) {
                result = await collection.findOneAndUpdate(query,
                    { $set: { pending: now } },
                    { returnDocument: ReturnDocument.AFTER }
                );
            }
*/
            // Try again if someone else marked pending first.
            if (result.value === null) {
                console.log(`Attempt #${attempts+1} failed, trying again...`);
                continue;
            }

            // Redeem and transfer tokens to purchaser.
            const secrets = require("../private/secrets");
            const theSigner = await InMemorySigner.fromSecretKey(secrets.default.account4);
            const Tezos = new TezosToolkit(rpcUrl);
            Tezos.setProvider({signer: theSigner});
            const fa2 = await Tezos.contract.at(fa2Contract);
            const escrow = await Tezos.contract.at(escrowContract);
            const batch = Tezos.contract.batch()
                // TODO: Evaluate expense.
                .withContractCall(fa2.methods.update_operators(result.value.tokenIds.map((id: number) => (
                    { add_operator: { operator: escrowContract, token_id: id, owner: adminAddress } }
                ))))
                .withContractCall(escrow.methodsObject.redeem_funds({ 
                    to: purchaserAddress,
                    ids: result.value.tokenIds,
                    amount: escrowAmount                
                }));

            const batchOp = await batch.send();
            console.log('Operation hash:', batchOp.hash);
            await batchOp.confirmation();
            console.log("Confirmed!");

            // Clear pending, mark sold.
            result = await collection.findOneAndUpdate(
                { _id: query._id },
                { $set: { sold: { date: Date(), hash: batchOp.hash, to: purchaserAddress, amount: escrowAmount } }, $unset: { pending: 0 } },
                { returnDocument: ReturnDocument.AFTER }
            );
            console.log(result);
            console.log("Done!");
            return true;
        }

        console.log("Giving up");

    } catch (error) {
        console.log(`Error: ${error}`);
        socket.emit('error', JSON.stringify(error));
    } finally {
        await mongoClient.close();
    }

    return false;
};