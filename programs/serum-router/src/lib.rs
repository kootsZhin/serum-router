// Serum Router

// swapExactTokensForTokens

// * token 0 -> token 1 -> token 2

// Params
// - Amount in
// - Amount out min
// - Match limit
// - Has discount token account

// Accounts
// - Spl token program
// - System program
// - Market 1 (token 0 -> token 1)
//   (assume token 0 is the base token and token 1 is the quote token for now)
//     - Address
//     - Orderbook
//     - Event queue
//     - Bids
//     - Asks
//     - Base valut
//     - Quote vault
//     - Market signer
// - Market 2 (token 1 -> token 2)
//   (assume token 2 is the base token and token 1 is the quote token for now)
//     - Address
//     - Orderbook
//     - Event queue
//     - Bids
//     - Asks
//     - Base valut
//     - Quote vault
//     - Market signer
// - User token 0 account (token 0)
// - User token 1 account (intermediate)
// - User token 2 account (token 2)
// - User owner
// - Discount token account
// - Fee referral account

// Process
// 1. Swap from token 0 to token 1
// 2. Swap from token 1 to token 2

use anchor_lang::prelude::*;
use anchor_spl::token;

pub mod swap;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// Associated token account for Pubkey::default.
mod empty {
    use super::*;
    declare_id!("HJt8Tjdsc9ms9i4WCZEzhzr4oyf3ANcdzXrNdLPFqm3M");
}

#[program]
pub mod serum_router {
    use super::*;

    pub fn swap_exact_tokens_for_tokens(
        ctx: Context<SwapExactTokensForTokens>,
        amount_in: u64,
        amount_out_min: u64,
        match_limit: u64,
        has_discount_token_account: u8,
    ) -> Result<()> {
        // Get remaining accounts
        let remaining_accounts_iter = ctx.remaining_accounts.iter();
        let discount_token_account = remaining_accounts_iter.next().map(Clone::clone);
        let fee_referral_account = remaining_accounts_iter.next().map(Clone::clone);

        let (from_amount, sell_proceeds) = {
            // Token balances before the trade.
            let base_before = token::accessor::amount(&ctx.accounts.input_token_account)?;
            let quote_before = token::accessor::amount(&ctx.accounts.intermediate_token_account)?;

            let orderbook = ctx.accounts.orderbook_from();

            // Token balances after the trade.
            let base_after = token::accessor::amount(&ctx.accounts.input_token_account)?;
            let quote_after = token::accessor::amount(&ctx.accounts.intermediate_token_account)?;

            // Report the delta.
            (
                base_before.checked_sub(base_after).unwrap(),
                quote_after.checked_sub(quote_before).unwrap(),
            )
        };

        let (to_amount, buy_proceeds) = {
            // Token balances before the trade.
            let base_before = token::accessor::amount(&ctx.accounts.input_token_account)?;
            let quote_before = token::accessor::amount(&ctx.accounts.intermediate_token_account)?;

            let orderbook = ctx.accounts.orderbook_from();

            // Token balances after the trade.
            let base_after = token::accessor::amount(&ctx.accounts.input_token_account)?;
            let quote_after = token::accessor::amount(&ctx.accounts.intermediate_token_account)?;

            // Report the delta.
            (
                base_before.checked_sub(base_after).unwrap(),
                quote_after.checked_sub(quote_before).unwrap(),
            )
        };

        // The amount of surplus quote currency *not* fully consumed by the
        // second half of the swap.
        let spill_amount = sell_proceeds.checked_sub(buy_proceeds).unwrap();

        Ok(())
    }
}

#[derive(Accounts)]
pub struct SwapExactTokensForTokens<'info> {
    // Markets
    pub from: MarketAccounts<'info>,
    pub to: MarketAccounts<'info>,
    // User token accounts
    #[account(mut, constraint = input_token_account.key != &empty::ID)]
    pub input_token_account: AccountInfo<'info>,
    #[account(mut, constraint = intermediate_token_account.key != &empty::ID)]
    pub intermediate_token_account: AccountInfo<'info>,
    #[account(mut, constraint = output_token_account.key != &empty::ID)]
    pub output_token_account: AccountInfo<'info>,
    // User wallet
    #[account(signer)]
    pub user_owner: AccountInfo<'info>,
    // Programs
    pub spl_token_program: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
    pub dex_program: AccountInfo<'info>,
}

impl<'info> SwapExactTokensForTokens<'info> {
    fn orderbook_from(&self) -> OrderbookClient<'info> {
        OrderbookClient {
            market: self.from.clone(),
            user_base_account: self.input_token_account.clone(),
            user_quote_account: self.intermediate_token_account.clone(),
            user_owner: self.user_owner.clone(),
            spl_token_program: self.spl_token_program.clone(),
            system_program: self.system_program.clone(),
            dex_program: self.dex_program.clone(),
        }
    }
    fn orderbook_to(&self) -> OrderbookClient<'info> {
        OrderbookClient {
            market: self.to.clone(),
            user_base_account: self.output_token_account.clone(),
            user_quote_account: self.intermediate_token_account.clone(),
            user_owner: self.user_owner.clone(),
            spl_token_program: self.spl_token_program.clone(),
            system_program: self.system_program.clone(),
            dex_program: self.dex_program.clone(),
        }
    }
}

#[derive(Clone)]
struct OrderbookClient<'info> {
    market: MarketAccounts<'info>,

    user_base_account: AccountInfo<'info>,
    user_quote_account: AccountInfo<'info>,
    user_owner: AccountInfo<'info>,

    spl_token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    dex_program: AccountInfo<'info>,
}

impl<'info> OrderbookClient<'info> {
    fn swap_cpi(
        &self,
        base_qty: u64,
        quote_qty: u64,
        match_limit: u64,
        side: u8,
        has_discount_token_account: u8,
    ) -> Result<()> {
        let ctx = CpiContext::new(self.dex_program.clone(), self.clone().into());
        swap::swap_v4(
            ctx,
            base_qty,
            quote_qty,
            match_limit,
            side,
            has_discount_token_account,
        )
    }
}

impl<'info> From<OrderbookClient<'info>> for swap::SwapV4<'info> {
    fn from(orderbook: OrderbookClient<'info>) -> swap::SwapV4<'info> {
        swap::SwapV4 {
            spl_token_program: orderbook.spl_token_program.clone(),
            system_program: orderbook.system_program.clone(),
            market: orderbook.market.market.clone(),
            orderbook: orderbook.market.orderbook.clone(),
            event_queue: orderbook.market.event_queue.clone(),
            bids: orderbook.market.bids.clone(),
            asks: orderbook.market.asks.clone(),
            base_vault: orderbook.market.base_vault.clone(),
            quote_vault: orderbook.market.quote_vault.clone(),
            market_signer: orderbook.market.market_signer.clone(),
            user_base_account: orderbook.user_base_account.clone(),
            user_quote_account: orderbook.user_quote_account.clone(),
            user_owner: orderbook.user_owner.clone(),
        }
    }
}

#[derive(Accounts, Clone)]
pub struct MarketAccounts<'info> {
    // The DEX market
    #[account(mut)]
    pub market: AccountInfo<'info>,
    // The orderbook
    #[account(mut)]
    pub orderbook: AccountInfo<'info>,
    // The AOB event queue
    #[account(mut)]
    pub event_queue: AccountInfo<'info>,
    // The AOB bids
    #[account(mut)]
    pub bids: AccountInfo<'info>,
    // The AOB asks
    #[account(mut)]
    pub asks: AccountInfo<'info>,
    // Also known as the "coin" currency. For a given A/B market,
    // this is the vault for the A mint.
    #[account(mut)]
    pub base_vault: AccountInfo<'info>,
    // Also known as the "price" currency. For a given A/B market,
    // this is the vault for the B mint.
    #[account(mut)]
    pub quote_vault: AccountInfo<'info>,
    // The DEX market signer
    pub market_signer: AccountInfo<'info>,
}
