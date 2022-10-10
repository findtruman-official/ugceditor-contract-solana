use anchor_lang::prelude::*;
use anchor_spl::{token::{Mint, Token, TokenAccount}, associated_token::AssociatedToken};

declare_id!("HTjMwzVwqxL7Tzfi1Lrq1aSsBqQ8zcJLN5Z9UhaApMmF");

#[account]
#[derive(Default)]
pub struct StoryFactory {
    next_id: u64,
    manager: Pubkey,
    published: u64,
}

#[account]
pub struct Story {
    id: u64,
    author: Pubkey,
    cid: String,
    // bump: u8,
} 

#[account]
pub struct StoryNftMintState {
    id: u64,
    total: u64,
    price: u64, // unit $Finds
    sold: u64,
    author_reserved: u64,
    author_claimed: u64,
    uri_prefix: String,
    // description: String, // limit 200
    // image: String, 
    title: String,
    
    finds_recv_address: Pubkey,
    finds_mint: Pubkey,
    // bump: u8,
}

#[event]
pub struct StoryUpdated {
    id: u64,
}


#[event]
pub struct StoryNftPublished {
    id: u64,
}

#[event]
pub struct NftMinted {
    story_id: u64,    
    mint: Pubkey,
}

#[derive(Accounts)]
#[instruction()]
pub struct Initialize<'info> {
    #[account(mut)]
    pub manager: Signer<'info>,

    #[account(
        init,
        space = 8 + StoryFactory::MAX_SIZE, 
        payer = manager,
        seeds = [b"factory".as_ref()],
        bump
    )]
    pub factory: Account<'info, StoryFactory>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction()]
pub struct PublishStory<'info> {
    #[account(mut)]
    pub author: Signer<'info>,

    #[account(
        mut,
        seeds = [b"factory".as_ref()],
        bump
    )]
    pub factory: Account<'info, StoryFactory>,

    // TODO cocurrent nextid problem
    #[account(
        init,
        space = 8 + Story::MAX_SIZE,
        payer = author,
        seeds = [
            b"story-".as_ref(), 
            factory.next_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub story: Account<'info, Story>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct UpdateStory<'info> {
    pub author: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"story-".as_ref(), 
            id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = story.author == author.key()
    )]
    pub story: Account<'info, Story>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct PublishStoryNFT<'info> {
    
    #[account(mut)]
    pub author: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"story-".as_ref(), 
            id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = story.author == author.key()
    )]
    pub story: Account<'info, Story>,

    #[account(
        init,
        payer = author,
        space=StoryNftMintState::MAX_SIZE,
        seeds = [
            b"story-mint-".as_ref(),
            id.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub mint_state: Account<'info, StoryNftMintState>,


    finds_mint: Account<'info, Mint>,

    #[account(
        
        // init_if_needed,
        // payer = author,
        associated_token::mint = finds_mint.to_account_info(),
        associated_token::authority = author,
    )]
    pub finds_recv_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct MintStoryNft<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,

    
    #[account(
        seeds = [
            b"story-".as_ref(), 
            id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub story: Account<'info, Story>,

    #[account(
        mut,
        seeds = [
            b"story-mint-".as_ref(),
            id.to_le_bytes().as_ref(),
        ],
        bump,
        constraint = mint_state.id == story.id
    )]
    pub mint_state: Account<'info, StoryNftMintState>,


    
    #[account(
        init,
        payer = minter,
        mint::decimals = 0,
        mint::authority = minter,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = minter,
        associated_token::mint = mint.to_account_info(),
        associated_token::authority = minter,
    )]
    pub token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = finds_mint.key() == mint_state.finds_mint
    )]
    pub finds_mint: Account<'info, Mint>,

    
    #[account(
        mut,
        associated_token::mint = finds_mint.to_account_info(),
        associated_token::authority = minter,
    )]
    pub finds_send_account: Box<Account<'info, TokenAccount>>, 

    #[account(
        mut,
        associated_token::mint = finds_mint.to_account_info(),
        associated_token::authority = story.author,
    )]
    pub finds_recv_account: Box<Account<'info, TokenAccount>>, 
    
    // /// CHECK: This is not dangerous because we don't read or write from this account
    // #[account(mut)] 
    // pub finds_send_account: UncheckedAccount<'info>,


    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub token_metadata_program: UncheckedAccount<'info>,

    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub rent: Sysvar<'info, Rent>,
}

#[program]
pub mod solana_programs {

    use anchor_lang::solana_program::program::invoke;
    use anchor_spl::token;
    use mpl_token_metadata::instruction::{create_master_edition_v3, create_metadata_accounts_v3};

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.factory.next_id = 1;
        ctx.accounts.factory.manager = ctx.accounts.manager.key();
        ctx.accounts.factory.published = 0;

        Ok(())
    }

    pub fn publish_story(ctx: Context<PublishStory>, cid: String) -> Result<()>{

        ctx.accounts.story.author = ctx.accounts.author.key();
        ctx.accounts.story.id = ctx.accounts.factory.next_id;
        ctx.accounts.story.cid = cid;

        ctx.accounts.factory.next_id += 1;
        ctx.accounts.factory.published += 1;

        emit!(StoryUpdated {
            id: ctx.accounts.story.id,
        });

        Ok(())
    }
    
    pub fn update_story(ctx: Context<UpdateStory>, id: u64, cid: String) -> Result<()> {
        ctx.accounts.story.cid = cid;
        emit!(StoryUpdated{
            id: ctx.accounts.story.id
        });
        Ok(())
    }

    pub fn publish_story_nft(
        ctx: Context<PublishStoryNFT>, 
        id: u64, 
        price: u64, 
        total: u64, 
        author_reserved: u64, 
        // image: String, 
        title: String,
        // description: String
        uri_prefix: String,
    ) -> Result<()> {
        let mint_state = &mut ctx.accounts.mint_state;
        mint_state.id = id;
        mint_state.total = total;
        mint_state.price = price;
        mint_state.author_reserved = author_reserved;
        mint_state.sold = 0;
        mint_state.author_claimed = 0;
        mint_state.finds_recv_address = ctx.accounts.finds_recv_account.key();
        mint_state.finds_mint = ctx.accounts.finds_mint.key();

        if author_reserved > total {
            panic!("Author reserved should less than total")
        }
        // if image.len() > 32 {
        //     panic!("Image too long")
        // }
        // mint_state.image = image;
        // if description.len() > 200 {
        //     panic!("Description too long")
        // }
        // mint_state.description = description;
        if uri_prefix.len() > 200 {
            panic!("uri_prefix too long")
        }
        mint_state.uri_prefix = uri_prefix;
        if title.len() >64 {
            panic!("Title too long")
        }
        mint_state.title = title;
        

        emit!(StoryNftPublished {
            id: id
        });

        Ok(())
    }
    
    pub fn mint_story_nft(ctx: Context<MintStoryNft>, id: u64) -> Result<()> {

        let mint_state = &mut ctx.accounts.mint_state;

        if mint_state.rest_sell_amount() <= 0 {
            panic!("not enough sell amount");
        }

        let finds_send_account = &mut ctx.accounts.finds_send_account;
        if finds_send_account.amount < mint_state.price {
            panic!("not enough tokens");
        }
        let cpi_accounts_transfer  = token::Transfer {
            from: finds_send_account.to_account_info(),
            to: ctx.accounts.finds_recv_account.to_account_info(),
            authority: ctx.accounts.minter.to_account_info(),
        };
        let cpi_program_token_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx_transfer = CpiContext::new(cpi_program_token_program, cpi_accounts_transfer);
        token::transfer(cpi_ctx_transfer, mint_state.price)?;

        msg!("send_account balance: {}", ctx.accounts.finds_send_account.amount);
        

        mint_state.sold += 1;


        msg!("MINT STORY NFT");
        let cpi_accounts_mint_to = token::MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.minter.to_account_info(),
        };
        msg!("CPI Accounts Assigned");
        let cpi_program_token = ctx.accounts.token_program.to_account_info();
        msg!("CPI Program Assigned");
        let ctx_mint_to = CpiContext::new(cpi_program_token, cpi_accounts_mint_to);
        msg!("CPI Context Assigned");

        token::mint_to(ctx_mint_to, 1)?;


        msg!("Token Minted !!!");
        let account_info = vec![
            ctx.accounts.metadata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.minter.to_account_info(), // mint authority
            ctx.accounts.minter.to_account_info(), // payer
            ctx.accounts.token_metadata_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ];

        msg!("Account Info Assigned");
        let creator = vec![
            mpl_token_metadata::state::Creator {
                address: ctx.accounts.story.author,
                verified: false,
                share: 100,
            },
            mpl_token_metadata::state::Creator {
                address: ctx.accounts.minter.key(),
                verified: false,
                share: 0,
            },
        ];
        msg!("Creator Assigned");
        let symbol = std::string::ToString::to_string("Story"); 
        // create_metadata_accounts_v3(program_id, metadata_account, mint, mint_authority, payer, update_authority, name, symbol, uri, creators, seller_fee_basis_points, update_authority_is_signer, is_mutable, collection, uses, collection_details)
        let uri = format!("{}/{}.json", mint_state.uri_prefix, ctx.accounts.story.id);
        // let uri = format!("{}/{}/{}", URI, ctx.accounts.story.id, ctx.accounts.token_account.key());

        let creator = Some(creator);
        invoke(
            &create_metadata_accounts_v3(
                ctx.accounts.token_metadata_program.key(),
                ctx.accounts.metadata.key(),
                ctx.accounts.mint.key(),
                ctx.accounts.minter.key(),
                ctx.accounts.minter.key(),
                ctx.accounts.minter.key(),
                ctx.accounts.mint_state.title.clone(),
                symbol,
                uri,
                creator,
                1,
                true,
                false,
                None,
                None,
                None
            ),
            account_info.as_slice(),
        )?;
        msg!("Metadata Account Created !!!");

        let master_edition_infos = vec![
            ctx.accounts.master_edition.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.minter.to_account_info(), // minter
            ctx.accounts.minter.to_account_info(), // payer
            ctx.accounts.metadata.to_account_info(),
            ctx.accounts.token_metadata_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ];
        msg!("Master Edition Account Infos Assigned");
        invoke(
            &create_master_edition_v3(
                ctx.accounts.token_metadata_program.key(),
                ctx.accounts.master_edition.key(),
                ctx.accounts.mint.key(),
                ctx.accounts.minter.key(),
                ctx.accounts.minter.key(),
                ctx.accounts.metadata.key(),
                ctx.accounts.minter.key(),
                Some(0),
            ),
            master_edition_infos.as_slice(),
        )?;
        msg!("Master Edition Nft Minted !!!");

        emit!(NftMinted {
            story_id: ctx.accounts.story.id,
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }


}


impl StoryFactory {
    pub const MAX_SIZE: usize = 8 + 32 + 8;
}

impl Story {
    pub const MAX_SIZE: usize = 8 + 32 + (4 + 64);
}


impl StoryNftMintState {
    pub const MAX_SIZE: usize = 8 + 8 +8 +8 + 8 + 8 + (4 + 200) + (4 + 200) + 32 + 32;

    fn total_sell_amount(&self) -> u64 {
        self.total - self.author_reserved
    }
    fn rest_sell_amount(&self) ->  u64{
        self.total - self.author_reserved - self.sold
    }
    fn rest_author_amount(&self) -> u64 {
        self.author_reserved - self.author_claimed
    }
}
