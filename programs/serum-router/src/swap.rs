use anchor_lang::prelude::*;

pub use dex_v4::instruction_auto::swap::{Accounts, Params};

#[allow(clippy::too_many_arguments)]
pub fn swap_v4<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, SwapV4<'info>>,
    base_qty: u64,
    quote_qty: u64,
    match_limit: u64,
    side: u8,
    has_discount_token_account: u8,
) -> Result<()> {
    let mut remaining_accounts_iter = ctx.remaining_accounts.iter();

    let mut discount_token_account: Option<AccountInfo> = None;
    if has_discount_token_account == 1 {
        discount_token_account = remaining_accounts_iter.next().map(Clone::clone);
    };

    let fee_referral_account = remaining_accounts_iter.next().map(Clone::clone);

    let params = Params {
        base_qty: base_qty,
        quote_qty: quote_qty,
        match_limit: match_limit,
        side: side,
        has_discount_token_account: has_discount_token_account,
        _padding: [0; 6],
    };

    let accounts = Accounts {
        spl_token_program: ctx.accounts.spl_token_program.key,
        system_program: ctx.accounts.system_program.key,
        market: ctx.accounts.market.key,
        orderbook: ctx.accounts.orderbook.key,
        event_queue: ctx.accounts.event_queue.key,
        bids: ctx.accounts.bids.key,
        asks: ctx.accounts.asks.key,
        base_vault: ctx.accounts.base_vault.key,
        quote_vault: ctx.accounts.quote_vault.key,
        market_signer: ctx.accounts.market_signer.key,
        user_base_account: ctx.accounts.user_base_account.key,
        user_quote_account: ctx.accounts.user_quote_account.key,
        user_owner: ctx.accounts.user_owner.key,
        discount_token_account: discount_token_account.map(|r| r.key),
        fee_referral_account: fee_referral_account.map(|r| r.key),
    };

    let ix = dex_v4::instruction_auto::swap(ctx.program.key().clone(), accounts, params);

    solana_program::program::invoke_signed(
        &ix,
        &ToAccountInfos::to_account_infos(&ctx),
        &ctx.signer_seeds,
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct SwapV4<'info> {
    pub spl_token_program: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
    pub market: AccountInfo<'info>,
    pub orderbook: AccountInfo<'info>,
    pub event_queue: AccountInfo<'info>,
    pub bids: AccountInfo<'info>,
    pub asks: AccountInfo<'info>,
    pub base_vault: AccountInfo<'info>,
    pub quote_vault: AccountInfo<'info>,
    pub market_signer: AccountInfo<'info>,
    pub user_base_account: AccountInfo<'info>,
    pub user_quote_account: AccountInfo<'info>,
    pub user_owner: AccountInfo<'info>,
}
