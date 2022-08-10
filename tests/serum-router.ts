import { Market } from "@bonfida/dex-v4";
import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { ACCOUNT_SIZE, createAssociatedTokenAccount, createInitializeAccountInstruction, getMinimumBalanceForRentExemptAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { SerumRouter } from "../target/types/serum_router";

const DEVNET_DEX_V4 = "CaBZ1iupVQBBBWKF4pVq19QB5tpymLP4ocD5wksd7AqB";
const SOL_USDC_MARKET = "89LWydsqk75RBwkMmWtLJdCVpzQVxHJmjVDidHvgCftn"; // With only bid liquidity (USDC)
const BTC_USDC_MARKET = "2XJ3mbLxyVUwkBx5VvuwH2La8xVXGGbpsqeeQk9tWtQB"; // With both side of liquidity
const ETH_USDC_MARKET = "Dcd1f6YNXUPamhVGfGMZ4xJBZY1kMX1MKXFRTw5375LZ"; // With both side of liquidity

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "43zS2spaz1Doi1KDevSFKxf1KWhNDfjwbnXL5j7GDNJ8";
const BTC_MINT = "ESspyQX2uXccWxJ4sQm5gN6AuQ7SwBCTLsHfRxHX5w85";
const ETH_MINT = "HypB1tUiVYLDutrreeQYAZxW7bYkgrdVq6gwgsKaeyPC";

let btcMarket: Market;
let wsolMarket: Market;
let ethMarket: Market;

let btcMarketSigner: anchor.web3.PublicKey;
let wsolMarketSigner: anchor.web3.PublicKey;
let ethMarketSigner: anchor.web3.PublicKey;

let Alice: anchor.web3.Keypair;

let wsolATA: anchor.web3.PublicKey;
let usdcATA: anchor.web3.PublicKey;
let btcATA: anchor.web3.PublicKey;
let ethATA: anchor.web3.PublicKey;

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

    wsolMarket = await Market.load(
      provider.connection,
      new anchor.web3.PublicKey(SOL_USDC_MARKET),
      new anchor.web3.PublicKey(DEVNET_DEX_V4)
    );

    ethMarket = await Market.load(
      provider.connection,
      new anchor.web3.PublicKey(ETH_USDC_MARKET),
      new anchor.web3.PublicKey(DEVNET_DEX_V4)
    );

    [btcMarketSigner] = await anchor.web3.PublicKey.findProgramAddress(
      [btcMarket.address.toBuffer()],
      btcMarket.programId
    );

    [wsolMarketSigner] = await anchor.web3.PublicKey.findProgramAddress(
      [wsolMarket.address.toBuffer()],
      wsolMarket.programId
    );

    [ethMarketSigner] = await anchor.web3.PublicKey.findProgramAddress(
      [ethMarket.address.toBuffer()],
      ethMarket.programId
    );

  });

  it("can load all the markets", async () => {
    assert.ok(btcMarket.address.toString() != "");
    assert.ok(wsolMarket.address.toString() != "");
    assert.ok(ethMarket.address.toString() != "");
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
    ethATA = await createAssociatedTokenAccount(provider.connection, Alice, new anchor.web3.PublicKey(ETH_MINT), Alice.publicKey);

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
    assert.ok((await provider.connection.getTokenAccountBalance(ethATA)).value.uiAmount == 0);
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
            market: wsolMarket.address,
            orderbook: wsolMarket.orderbookAddress,
            eventQueue: wsolMarket.eventQueueAddress,
            bids: wsolMarket.bidsAddress,
            asks: wsolMarket.asksAddress,
            baseVault: wsolMarket.baseVault,
            quoteVault: wsolMarket.quoteVault,
            marketSigner: wsolMarketSigner
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
              market: wsolMarket.address,
              orderbook: wsolMarket.orderbookAddress,
              eventQueue: wsolMarket.eventQueueAddress,
              bids: wsolMarket.bidsAddress,
              asks: wsolMarket.asksAddress,
              baseVault: wsolMarket.baseVault,
              quoteVault: wsolMarket.quoteVault,
              marketSigner: wsolMarketSigner
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

  it("can swap from BTC to ETH via USDC", async () => {

    const btcBefore = (await provider.connection.getTokenAccountBalance(btcATA)).value.uiAmount;
    const usdcBefore = (await provider.connection.getTokenAccountBalance(usdcATA)).value.uiAmount;
    const ethBefore = (await provider.connection.getTokenAccountBalance(ethATA)).value.uiAmount;

    const swapTx = await program.rpc.swapExactTokensForTokens(
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
            market: ethMarket.address,
            orderbook: ethMarket.orderbookAddress,
            eventQueue: ethMarket.eventQueueAddress,
            bids: ethMarket.bidsAddress,
            asks: ethMarket.asksAddress,
            baseVault: ethMarket.baseVault,
            quoteVault: ethMarket.quoteVault,
            marketSigner: ethMarketSigner
          },
          inputTokenAccount: btcATA,
          intermediateTokenAccount: usdcATA,
          outputTokenAccount: ethATA,
          userOwner: Alice.publicKey,
          splTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          dexProgram: new anchor.web3.PublicKey(DEVNET_DEX_V4)
        },
        signers: [Alice]
      },
    );

    const btcAfter = (await provider.connection.getTokenAccountBalance(btcATA)).value.uiAmount;
    const usdcAfter = (await provider.connection.getTokenAccountBalance(usdcATA)).value.uiAmount;
    const ethAfter = (await provider.connection.getTokenAccountBalance(ethATA)).value.uiAmount;

    assert.ok(ethAfter - ethBefore > 0);
    assert.ok(Math.floor(Math.abs(usdcAfter - usdcBefore)) == 0);
    assert.ok(btcAfter - btcBefore < 0);
  });

});