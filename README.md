# Serum Router

`serum-router` is a router program providing a convenient API for performing atomic swap on the [Serum v4 orderbook](https://github.com/bonfida/dex-v4).  

Similar to [`project-serum/swap`](https://github.com/project-serum/swap) for Serum v3 and [`Uniswap/v2-periphery`](https://github.com/Uniswap/v2-periphery) for Uniswap.  

## How it works?

`swap_exact_tokens_for_tokens` is the core function of the program utilizing the `swap` function in the v4 program to perform atomic swap on the orderbook.  


For example on BTC/USDC and SOL/USDC markets, we can do,  
```javascript
BTC -> USDC -> SOL
```

Currently only swapping `token0` to `token2` through `token0/token1` and `token2/token1` markets where `token1` as the intermediate token is supported.  

The idea is bundling `token0 -> token1` and `token1 -> token2` swaps through CPI calls and revert if not enough output amount or any failure in one of the CPI calls.  

## Deployment / Testing

Deployed devnet address: `DthR1weAAyUJ2hnTFNafvJP1eSkTvNTNhYw8YsSUMSTA`

```bash
anchor test --skip-lint
```
