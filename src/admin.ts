import fs from "fs";
import path from "path";
import { Socket } from "socket.io";
import { getDirectory } from "./utils";
import { randrange, sfc32, xmur3 } from "./random";
import { allCards, totalCards } from "./tarot";
import { NFTStorage } from "nft.storage";
import { MongoClient } from "mongodb";
import { TezosToolkit, MichelsonMap } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";
import { char2Bytes } from "@taquito/utils";
import { fa2Contract, rpcUrl } from "./contracts";

export const adminAddress = "tz1Qej2aPmeZECBZHV5meTLC1X6DWRhSCoY4";

type ContractStorage = {
    administrator: string,
    all_tokens: number,
    metadata: string,
    operators: string,
    paused: string,
    total_supply: string
};

// A lot is a large collection of cards.
// Each set minting typically consists of four separate lots.
// Each lot has a different total number of cards, making cards from one lot
// rarer than those from another lot.
// Cards within a lot may also have differing relative rarity.

type CardLot = {
    name: string, // rand 4 letter id [a..z]
    CID: string, // metadata directory
};

type CardRef = {
    lotIndex: number, // [0..4)
    cardIndex: number // [0..78)
};

type CardPack = {
    tokenIds: number[]
}

let setCID = "bafybeiefg5nl5ioy37lrzizqxmb4woadptwjjegtarv2nfqohxzitsd4be";

export const mintSet = async (socket: Socket, set: string, minting: string) => {
    const mongodb = require("../private/mongodb");
    const mongoClient = new MongoClient(mongodb.uri);
    try {
        const name = `${set} - ${minting}`;
        console.log(`Minting "${name}" set...`);

        const setpath = path.join(__dirname, '../sets', set);
        const cards = allCards();

        const storageKeys = require("../private/storageKeys");
        const storage = new NFTStorage({
            token: storageKeys.default.apiKey
        });

        // Upload card textures if needed.
        if (setCID === "") {

            // Verify required assets exist.
            for (let card of cards) {
                const imagename = `${card}.png`;
                const cardpath = path.join(setpath, imagename);
                if (!fs.existsSync(cardpath)) {
                    console.log(`Could not find ${cardpath}`);
                    throw `Missing ${imagename}`
                }
            }

            // Pin to IPFS.
            const directory = await getDirectory(socket, setpath);
            setCID = await storage.storeDirectory(directory);
            console.log({ setCID });
            console.log(await storage.status(setCID));
        }

        // Init RNG.
        const seed = xmur3(set);
        const rand = sfc32(seed(), seed(), seed(), seed());

        // Generate unique four character random strings to identify each lot.
        // These names are deterministically generated from the set's name.
        const lots = ((num = 4) => {
            const ch = randrange(97, 122, rand); // a..z
            let lots: CardLot[] = [];
            for (let i = 0; i < num; i++) {
                let name: string;
                do { name = String.fromCharCode(ch(), ch(), ch(), ch()); }
                while (lots.some((lot) => lot.name === name)); // filter dups
                lots.push({name: name, CID: ""});
            }
            return lots;
        })();

        // Ensure lot subdirs exist.
        for (let lot of lots) {
            const lotpath = path.join(setpath, lot.name);
            if (!fs.existsSync(lotpath)) {
                fs.mkdirSync(lotpath);
            }
        }

        // Generate metadata.
        const pct = ((i=0, max=cards.length) => () => ++i / max * 100)();
        for (let card of cards) {

            // Update client progress bar
            socket.emit('pct', pct(), card);

            const artifactUri = `ipfs://${setCID}/${card}.png`;

            // See if there is a separate display image to use.
            const displayname = `${card}-display.png`;
            const hasDisplay = fs.existsSync(path.join(setpath, displayname));
            const displayUri = hasDisplay ? `ipfs://${setCID}/${displayname}` : artifactUri;

            // TODO: Upload and assign thumbnail art
            // TODO: Add description field?  Might be useful for naming e.g.:
            //         set: rws
            //         description: Ace of cups from the Rider Waite Smith set.

            // https://gitlab.com/tezos/tzip/-/blob/master/proposals/tzip-21/tzip-21.md
            let metadata = {
                // Base fields
                name: card,
                symbol: "da",
                decimals: 0,
                // Fungible fields
                shouldPreferSymbol: false,
                thumbnailUri: artifactUri,
                // Semi-fungible / NFT fields
                artifactUri: artifactUri,
                displayUri: displayUri,
                minter: adminAddress,
                creators: ["digital-arcana"],
                isBooleanAmount: false,
                // Custom fields
                set: set,
                minting: minting,
                lot: ""
            };

            // Save to disk (each lot gets its own subdir).
            for (let lot of lots) {
                metadata.lot = lot.name;
                const jsonpath = path.join(setpath, lot.name, `${card}.json`);
                fs.writeFileSync(jsonpath, JSON.stringify(metadata, null, 2));
            }
        }

        // Upload json (dir per lot) to IPFS, record CIDs.
        for (let lot of lots) {
            const lotpath = path.join(setpath, lot.name);
            const directory = await getDirectory(socket, lotpath);
            lot.CID = await storage.storeDirectory(directory);
            console.log(`${lot.name}: ${lot.CID}`);
            console.log(await storage.status(lot.CID));
        }

        // TODO: Pass in per set / minting.
        const lotSizes = [
            10 * totalCards,        //     780 cards
            100 * totalCards,       //   7,800 cards
            500 * totalCards,       //  39,000 cards
            1000 * totalCards,      //  78,000 cards
        ];                          // 125,580 total
                                    //  17,940 packs (of seven)

        const lotsTotals = Array(lots.length).fill([]);
        let remaining: CardRef[] = [];

        // Add complete decks for the rarest lot.
        const numRareDecks = lotSizes[0] / totalCards;
        for (let i = 0; i < totalCards; i++) {
            for (let j = 0; j < numRareDecks; j++) {
                remaining.push({lotIndex: 0, cardIndex: i});
            }
            lotsTotals[0].push(numRareDecks);
        }

        // Assign each card a relative odds.
        // Collect cumulative values.
        // TODO: Store in binary tree for faster lookup.
        for (let lotIndex = 1; lotIndex < lotSizes.length; lotIndex++) {
            let odds: number[] = [];
            let cumulativeOdds: number[] = [];
            let selectOdds = randrange(900, 1000, rand);
            let total = 0;
            for (let i = 0; i < totalCards; i++) {
                total += odds[i] = selectOdds();
                cumulativeOdds.push(total);
            }
            socket.emit('odds', odds);

            const pick = (): number => {
                let n = rand() % total;
                for (let i = 0; i < totalCards; i++) {
                    if (n < cumulativeOdds[i]) {
                        return i;
                    }
                }
                console.log("Pick failure!");
                return 0;
            }

            // Pick cards, keep track of totals.
            const lotSize = lotSizes[lotIndex];
            const totals = Array(totalCards).fill(0);
            for (let i = 0; i < lotSize; i++) {
                const cardIndex = pick();
                remaining.push({lotIndex: lotIndex, cardIndex: cardIndex});
                ++totals[cardIndex];
            }
            socket.emit('totals', totals);
            lotsTotals[lotIndex] = totals;
        }

        // Verify totals.
        (() => {
            let lotsTotal = 0;
            for (let lotTotals of lotsTotals) {
                let lotTotal = lotTotals.reduce((cumulative: number, n: number) => cumulative + n);
                console.log(`lot total: ${lotTotal}`);
                lotsTotal += lotTotal;
            }
            console.log(`total: ${lotsTotal}`);
        })();

        // Connect to database server for storing packs.
        await mongoClient.connect();
        const db = mongoClient.db("packs");
        const collection = db.collection(name);
        const results = collection.find();
        const count = await results.count();
        if (count === 0) {
            console.log("Generating packs...");

            let packs: CardPack[] = [];

            // Pick seven at a time randomly with removal.
            const numCardsPerPack = 7;
            const mintTotals = Array(totalCards).fill(0);
            while (remaining.length >= numCardsPerPack) {
                let pack: CardPack = {tokenIds: []};
                for (let i = 0; i < numCardsPerPack; i++) {
                    const n = rand() % remaining.length;
                    const card = remaining[n];
                    const tokenId = card.lotIndex * totalCards + card.cardIndex;
                    // Filter out dups.
                    if (pack.tokenIds.includes(tokenId)) {
                        // Give up on last pack.
                        if (remaining.length <= numCardsPerPack) {
                            console.log("Found dup in last pack!");
                            break;
                        }
                        --i;
                        continue;
                    }
                    pack.tokenIds.push(tokenId);
                    remaining.splice(n, 1);
                    mintTotals[card.cardIndex]++;
                }
                packs.push(pack);
            }
            console.log(`packs: ${packs.length}`);
            console.log({mintTotals});

            // Verify pack totals.
            (() => {
                let packTotals = Array(lots.length).fill([])
                    .map(() => Array(totalCards).fill(0));
                for (let pack of packs) {
                    for (let tokenId of pack.tokenIds) {
                        const lotIndex = Math.floor(tokenId / totalCards);
                        const cardIndex = tokenId % totalCards;
                        packTotals[lotIndex][cardIndex]++;
                    }
                }
                for (let packTotal of packTotals) {
                    const total = packTotal.reduce((cumulative: number, n: number) => cumulative + n);
                    console.log(`pack total: ${total}`);
                }
            })();

            // Upload to MongoDB Atlas database server.
            await collection.drop();
            const insertResults = await collection.insertMany(packs, {ordered: true});
            console.log(insertResults.insertedCount);
        }

        // Mint totals.
        const secrets = require("../private/secrets");
        const theSigner = await InMemorySigner.fromSecretKey(secrets.default.account4);
        const Tezos = new TezosToolkit(rpcUrl);
        Tezos.setProvider({signer: theSigner});
        const publicKeyHash = await Tezos.signer.publicKeyHash();
        const contract = await Tezos.contract.at(fa2Contract);
        const contractStorage: ContractStorage = await contract.storage();
        const startId = Number(contractStorage.all_tokens);

        for (let lotIndex = 0; lotIndex < lots.length; lotIndex++) {
            const lot = lots[lotIndex];
            if (lot.CID === "") {
                throw("Lot CID not initialized");
            }

            if (startId > lotIndex * totalCards) {
                console.log(`Skipping ${lot.name}, already minted`);
                continue;
            }

            const batch = Tezos.contract.batch();
            const pct = ((i=0, max=cards.length) => () => ++i / max * 100)();
            for (let cardIndex = 0; cardIndex < totalCards; cardIndex++) {
                const card = cards[cardIndex];

                // Update client progress bar
                socket.emit('pct', pct(), card);

                const tokenId = lotIndex * totalCards + cardIndex;
                if (startId > tokenId) {
                    continue;
                }

                // Verify db total matches.
                const count = await collection.find({tokenIds: tokenId}).count();
                const expected = lotsTotals[lotIndex][cardIndex];
                if (count !== expected) {
                    throw(`Mismatch: id=${tokenId} (${count} vs ${expected})`);
                }

                console.log(`Minting: ${tokenId} ${lot.name}/${card} amt=${count}`);

                const metadataUri = `ipfs://${lot.CID}/${card}.json`;
                batch.withContractCall(contract.methodsObject.mint({
                    address: publicKeyHash,
                    amount: count,
                    metadata: MichelsonMap.fromLiteral({'': char2Bytes(metadataUri)}),
                    token_id: tokenId
                }));
            }

            const batchOp = await batch.send();

            // Wait for confirmation before continuing on to the next set,
            // otherwise we will get token_id out of order errors.
            await batchOp.confirmation();
        }

        socket.emit('pct', 100, name);
        console.log("Done!");

    } catch (error) {
        socket.emit('error', JSON.stringify(error));
        throw error;
    } finally {
        await mongoClient.close();
    }
}

// TODO: Sell packs
//       Use secondary smart contract, verify ownership, batch transfer
//       Sell packs in order?
//       Keep track of packs with at least one of higher tier cards for selling separately.
//       Can probably just keep track of sold status, and use queries to get non-sold, pick randomly.
//       Ensure DB operations are atomic