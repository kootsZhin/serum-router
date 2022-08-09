import { Market } from "@bonfida/dex-v4";
import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { ACCOUNT_SIZE, createAssociatedTokenAccount, createInitializeAccountInstruction, getMinimumBalanceForRentExemptAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { SerumRouter } from "../target/types/serum_router";

const DEVNET_DEX_V4 = "CaBZ1iupVQBBBWKF4pVq19QB5tpymLP4ocD5wksd7AqB";
const BTC_USDC_MARKET = "2XJ3mbLxyVUwkBx5VvuwH2La8xVXGGbpsqeeQk9tWtQB"; // With both side of liquidity
const SOL_USDC_MARKET = "89LWydsqk75RBwkMmWtLJdCVpzQVxHJmjVDidHvgCftn"; // With only bid liquidity (USDC)

const BTC_MINT = "ESspyQX2uXccWxJ4sQm5gN6AuQ7SwBCTLsHfRxHX5w85";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "43zS2spaz1Doi1KDevSFKxf1KWhNDfjwbnXL5j7GDNJ8";

let btcMarket: Market;
let solMarket: Market;

let btcMarketSigner: anchor.web3.PublicKey;
let solMarketSigner: anchor.web3.PublicKey;

let Alice: anchor.web3.Keypair;

let wsolATA: anchor.web3.PublicKey;
let usdcATA: anchor.web3.PublicKey;
let btcATA: anchor.web3.PublicKey;

let wsolKeypair: anchor.web3.Keypair;

describe("serum-router", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SerumRouter as Program<SerumRouter>;
  const provider = anchor.getProvider();

  before("Markets set up!", async () => {

    btcMarket = await Market.load(
      provider.connection,
      new anchor.web3.PublicKey(BTC_USDC_MARKET),
      new anchor.web3.PublicKey(DEVNET_DEX_V4)
    );

    solMarket = await Market.load(
      provider.connection,
      new anchor.web3.PublicKey(SOL_USDC_MARKET),
      new anchor.web3.PublicKey(DEVNET_DEX_V4)
    );

    [btcMarketSigner] = await anchor.web3.PublicKey.findProgramAddress(
      [btcMarket.address.toBuffer()],
      btcMarket.programId
    );

    [solMarketSigner] = await anchor.web3.PublicKey.findProgramAddress(
      [solMarket.address.toBuffer()],
      solMarket.programId
    );

  });

  it("can load all the markets", async () => {
    assert.ok(btcMarket.address.toString() != "");
    assert.ok(solMarket.address.toString() != "");
  });

  it("can set up Alice's account", async () => {
    Alice = anchor.web3.Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        Alice.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "finalized"
    );

    assert.ok(await program.provider.connection.getBalance(Alice.publicKey) == 2 * anchor.web3.LAMPORTS_PER_SOL);

    wsolKeypair = anchor.web3.Keypair.generate();
    wsolATA = wsolKeypair.publicKey;
    usdcATA = await createAssociatedTokenAccount(provider.connection, Alice, new anchor.web3.PublicKey(USDC_MINT), Alice.publicKey);
    btcATA = await createAssociatedTokenAccount(provider.connection, Alice, new anchor.web3.PublicKey(BTC_MINT), Alice.publicKey);

    const transferSolTx = await provider.connection.sendTransaction(
      (new anchor.web3.Transaction).add(...[
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: Alice.publicKey,
          newAccountPubkey: wsolATA,
          lamports: await getMinimumBalanceForRentExemptAccount(provider.connection),
          space: ACCOUNT_SIZE,
          programId: TOKEN_PROGRAM_ID
        }),
        anchor.web3.SystemProgram.transfer({
          fromPubkey: Alice.publicKey,
          toPubkey: wsolATA,
          lamports: 1 * anchor.web3.LAMPORTS_PER_SOL
        }),
        createInitializeAccountInstruction(
          wsolATA,
          new anchor.web3.PublicKey(WRAPPED_SOL_MINT),
          Alice.publicKey
        )
      ]),
      [Alice, wsolKeypair]
    );

    await provider.connection.confirmTransaction(transferSolTx, "finalized");

    assert.ok((await provider.connection.getTokenAccountBalance(wsolATA)).value.uiAmount == 1);
    assert.ok((await provider.connection.getTokenAccountBalance(usdcATA)).value.uiAmount == 0);
    assert.ok((await provider.connection.getTokenAccountBalance(btcATA)).value.uiAmount == 0);
  });

  it("can swap from WSOL to BTC via USDC", async () => {

    const wsolBefore = (await provider.connection.getTokenAccountBalance(wsolATA)).value.uiAmount;
    const usdcBefore = (await provider.connection.getTokenAccountBalance(usdcATA)).value.uiAmount;
    const btcBefore = (await provider.connection.getTokenAccountBalance(btcATA)).value.uiAmount;

    const swapTx = await program.rpc.swapExactTokensForTokens(
      new anchor.BN(1e9),
      new anchor.BN(1e4), // small amount for min output here for testing
      new anchor.BN(2 ** 32),
      0,
      {
        accounts: {
          from: {
            market: solMarket.address,
            orderbook: solMarket.orderbookAddress,
            eventQueue: solMarket.eventQueueAddress,
            bids: solMarket.bidsAddress,
            asks: solMarket.asksAddress,
            baseVault: solMarket.baseVault,
            quoteVault: solMarket.quoteVault,
            marketSigner: solMarketSigner
          },
          to: {
            market: btcMarket.address,
            orderbook: btcMarket.orderbookAddress,
            eventQueue: btcMarket.eventQueueAddress,
            bids: btcMarket.bidsAddress,
            asks: btcMarket.asksAddress,
            baseVault: btcMarket.baseVault,
            quoteVault: btcMarket.quoteVault,
            marketSigner: btcMarketSigner
          },
          inputTokenAccount: wsolATA,
          intermediateTokenAccount: usdcATA,
          outputTokenAccount: btcATA,
          userOwner: Alice.publicKey,
          splTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          dexProgram: new anchor.web3.PublicKey(DEVNET_DEX_V4)
        },
        signers: [Alice]
      },
    );

    const wsolAfter = (await provider.connection.getTokenAccountBalance(wsolATA)).value.uiAmount;
    const usdcAfter = (await provider.connection.getTokenAccountBalance(usdcATA)).value.uiAmount;
    const btcAfter = (await provider.connection.getTokenAccountBalance(btcATA)).value.uiAmount;

    assert.ok(wsolBefore - wsolAfter == 1);
    assert.ok(Math.floor(usdcAfter - usdcBefore) == 0);
    assert.ok(btcAfter - btcBefore > 0);
  });

  // This is expected to fail because the there's no ask liquidity placed for the WSOL/USDC market
  it("cannot swap from BTC to WSOL via USDC", async () => {

    const wsolBefore = (await provider.connection.getTokenAccountBalance(wsolATA)).value.uiAmount;
    const usdcBefore = (await provider.connection.getTokenAccountBalance(usdcATA)).value.uiAmount;
    const btcBefore = (await provider.connection.getTokenAccountBalance(btcATA)).value.uiAmount;

    try {
      await program.rpc.swapExactTokensForTokens(
        new anchor.BN((await provider.connection.getTokenAccountBalance(btcATA)).value.amount),
        new anchor.BN(1e4), // small amount for min output here for testing
        new anchor.BN(2 ** 32),
        0,
        {
          accounts: {
            from: {
              market: btcMarket.address,
              orderbook: btcMarket.orderbookAddress,
              eventQueue: btcMarket.eventQueueAddress,
              bids: btcMarket.bidsAddress,
              asks: btcMarket.asksAddress,
              baseVault: btcMarket.baseVault,
              quoteVault: btcMarket.quoteVault,
              marketSigner: btcMarketSigner
            },
            to: {
              market: solMarket.address,
              orderbook: solMarket.orderbookAddress,
              eventQueue: solMarket.eventQueueAddress,
              bids: solMarket.bidsAddress,
              asks: solMarket.asksAddress,
              baseVault: solMarket.baseVault,
              quoteVault: solMarket.quoteVault,
              marketSigner: solMarketSigner
            },
            inputTokenAccount: btcATA,
            intermediateTokenAccount: usdcATA,
            outputTokenAccount: wsolATA,
            userOwner: Alice.publicKey,
            splTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            dexProgram: new anchor.web3.PublicKey(DEVNET_DEX_V4)
          },
          signers: [Alice]
        },
      );
    } catch (e) {
      const wsolAfter = (await provider.connection.getTokenAccountBalance(wsolATA)).value.uiAmount;
      const usdcAfter = (await provider.connection.getTokenAccountBalance(usdcATA)).value.uiAmount;
      const btcAfter = (await provider.connection.getTokenAccountBalance(btcATA)).value.uiAmount;

      assert.ok(wsolAfter === wsolBefore);
      assert.ok(usdcAfter === usdcBefore);
      assert.ok(btcAfter === btcBefore);

      return;
    }

    assert.fail("This test should have failed because there's no ask liquidity placed for the WSOL/USDC market");

  });

});