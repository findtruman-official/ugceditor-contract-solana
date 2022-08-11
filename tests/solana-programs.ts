import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { assert } from "chai";
import { SolanaPrograms } from "../target/types/solana_programs";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  MINT_SIZE,
} from "@solana/spl-token";
import { keypairIdentity, Metaplex } from "@metaplex-foundation/js";
import * as spltoken from "@solana/spl-token";

describe("solana-programs", () => {
  const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SolanaPrograms as Program<SolanaPrograms>;

  const manager = anchor.web3.Keypair.generate();
  let factory: anchor.web3.PublicKey = null;

  const author = anchor.web3.Keypair.generate();
  const getStoryKey = async (id: anchor.BN) => {
    return (
      await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from(anchor.utils.bytes.utf8.encode("story-")),
          id.toBuffer("le", 8),
        ],
        program.programId
      )
    )[0];
  };

  const getMintStateKey = async (id: anchor.BN) => {
    return (
      await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from(anchor.utils.bytes.utf8.encode("story-mint-")),
          id.toBuffer("le", 8),
        ],
        program.programId
      )
    )[0];
  };
  const getMetadataKey = async (
    mint: anchor.web3.PublicKey
  ): Promise<anchor.web3.PublicKey> => {
    return (
      await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("metadata"),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )
    )[0];
  };

  const getMasterEditionKey = async (
    mint: anchor.web3.PublicKey
  ): Promise<anchor.web3.PublicKey> => {
    return (
      await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("metadata"),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
          Buffer.from("edition"),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )
    )[0];
  };

  const minter = anchor.web3.Keypair.generate();

  const metaplex = Metaplex.make(anchor.getProvider().connection).use(
    keypairIdentity(minter)
  );

  let findsMint: anchor.web3.PublicKey = null;

  it("Is initialized!", async () => {
    await airdropSOL({
      provider: anchor.getProvider(),
      target: manager.publicKey,
      amount: anchor.web3.LAMPORTS_PER_SOL,
    });

    findsMint = await createMintAndAirdrop([{ acc: minter, amount: 1000 }], {
      connection: anchor.getProvider().connection,
      payer: manager,
    });

    factory = (
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from(anchor.utils.bytes.utf8.encode("factory"))],
        program.programId
      )
    )[0];

    await program.methods
      .initialize()
      .accounts({
        manager: manager.publicKey,
        factory: factory,
      })
      .signers([manager])
      .rpc({});

    const factoryData = await program.account.storyFactory.fetch(factory);
    assert.deepEqual(factoryData.manager, manager.publicKey);
    assert.equal(factoryData.nextId.toString(), "1");
    assert.deepEqual(factoryData.published.toString(), "0");
  });

  it("Story is published", async () => {
    await airdropSOL({
      provider: anchor.getProvider(),
      target: author.publicKey,
      amount: anchor.web3.LAMPORTS_PER_SOL,
    });

    const storyId = new anchor.BN(1);

    await program.methods
      .publishStory("CID")
      .accounts({
        author: author.publicKey,
        factory: factory,
        story: await getStoryKey(storyId),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([author])
      .rpc({});

    const storyData = await program.account.story.fetch(
      await getStoryKey(storyId)
    );
    assert.deepEqual(storyData.author, author.publicKey);
    assert.equal(storyData.cid, "CID");
    assert.equal(storyData.id.toString(), storyId.toString());
  });

  it("Story is updated", async () => {
    const storyId = new anchor.BN(1);
    await program.methods
      .updateStory(storyId, "CID_NEW")
      .accounts({
        author: author.publicKey,
        story: await getStoryKey(storyId),
      })
      .signers([author])
      .rpc({});

    const storyData = await program.account.story.fetch(
      await getStoryKey(storyId)
    );
    assert.deepEqual(storyData.author, author.publicKey);
    assert.equal(storyData.cid, "CID_NEW");
    assert.equal(storyData.id.toString(), storyId.toString());
  });

  it("Story published NFT", async () => {
    const storyId = new anchor.BN(1);

    const findsRecvAddr = await getAssociatedTokenAddress(
      findsMint,
      author.publicKey
    );

    const mint_tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        author.publicKey,
        findsRecvAddr,
        author.publicKey,
        findsMint
      )
    );

    const res = await program.provider.sendAndConfirm(mint_tx, [author]);
    // console.log(
    //   await program.provider.connection.getParsedAccountInfo(mintKey.publicKey)
    // );
    // console.log(res, "RES")

    await program.methods
      .publishStoryNft(
        storyId,
        new anchor.BN(200),
        new anchor.BN(5000),
        new anchor.BN(1200),
        "TITLE",
        "URI_PREFIX"
      )
      .accounts({
        author: author.publicKey,
        story: await getStoryKey(storyId),
        mintState: await getMintStateKey(storyId),
        systemProgram: anchor.web3.SystemProgram.programId,
        findsMint: findsMint,
        findsRecvAccount: findsRecvAddr,
      })
      .signers([author])
      .rpc({});

    const mintStateData = await program.account.storyNftMintState.fetch(
      await getMintStateKey(storyId)
    );
    assert.equal(mintStateData.uriPrefix, "URI_PREFIX");
    assert.equal(mintStateData.title, "TITLE");
    assert.equal(mintStateData.authorReserved.toString(), "1200");
    assert.equal(mintStateData.total.toString(), "5000");
    assert.equal(mintStateData.price.toString(), "200");
    assert.equal(mintStateData.id.toString(), "1");
  });

  it("Story NFT Minted", async () => {
    await airdropSOL({
      provider: anchor.getProvider(),
      target: minter.publicKey,
      amount: anchor.web3.LAMPORTS_PER_SOL,
    });

    const storyId = new anchor.BN(1);

    const mint = anchor.web3.Keypair.generate();
    const lamports: number =
      await program.provider.connection.getMinimumBalanceForRentExemption(
        MINT_SIZE
      );

    const findsSendAccount = await getOrCreateAssociatedTokenAccount(
      anchor.getProvider().connection,
      minter,
      findsMint,
      minter.publicKey
    );
    // const findsSendAccount = await getAssociatedTokenAddress(
    //   findsMint,
    //   minter.publicKey
    // );

    const NftTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      minter.publicKey
    );
    console.log(`NFT TOKEN ACCOUNT ${NftTokenAccount}`);

    await program.methods
      .mintStoryNft(storyId)
      .accounts({
        story: await getStoryKey(storyId),
        minter: minter.publicKey,
        mintState: await getMintStateKey(storyId),
        mint: mint.publicKey,
        metadata: await getMetadataKey(mint.publicKey),
        tokenAccount: NftTokenAccount,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        masterEdition: await getMasterEditionKey(mint.publicKey),
        findsMint: findsMint,
        findsSendAccount: findsSendAccount.address,
        findsRecvAccount: await getAssociatedTokenAddress(
          findsMint,
          author.publicKey
        ),
      })
      .signers([minter, mint])
      .rpc({})
      .catch(console.error);

    const mintStateData = await program.account.storyNftMintState.fetch(
      await getMintStateKey(storyId)
    );

    const nftData = await metaplex.nfts().findByMint(mint.publicKey).run();

    const nowSendAccount = await getOrCreateAssociatedTokenAccount(
      anchor.getProvider().connection,
      minter,
      findsMint,
      minter.publicKey
    );
    const nowRecvAccount = await getOrCreateAssociatedTokenAccount(
      anchor.getProvider().connection,
      author,
      findsMint,
      author.publicKey
    );
    assert.equal(nowSendAccount.amount.toString(), "800");
    assert.equal(nowRecvAccount.amount.toString(), "200");

    assert.equal(nftData.name, "TITLE");
    assert.equal(nftData.symbol, "Story");
    assert.equal(nftData.uri, "URI_PREFIX/1.json");

    assert.equal(mintStateData.sold.toString(), "1");
  });
});

//  Utils
async function airdropSOL(opts: {
  target: anchor.web3.PublicKey;
  amount: number;
  provider: anchor.Provider;
}) {
  const { target, amount, provider } = opts;
  console.log(`[SOL] airdrop ${shortPubkey(target)} with ${amount} lamports`);
  const signature = await provider.connection.requestAirdrop(target, amount);
  const { value } =
    await await provider.connection.getLatestBlockhashAndContext();
  await provider.connection.confirmTransaction({
    signature,
    ...value,
  });
  const balance = await provider.connection.getBalance(target);
  console.log(`[SOL] balance of ${shortPubkey(target)} is ${balance} lamports`);
  return amount;
}
function shortPubkey(pubkey: anchor.web3.PublicKey) {
  const full = `${pubkey}`;
  return "[" + full.slice(0, 6) + "..." + full.slice(full.length - 6) + "]";
}

async function createMintAndAirdrop(
  airdrops: { acc: anchor.web3.Keypair; amount: number }[],
  opts: {
    connection: anchor.web3.Connection;
    payer: anchor.web3.Keypair;
  }
) {
  const { connection, payer } = opts;
  const mintAddr = await spltoken.createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    9,
    undefined,
    undefined,
    spltoken.TOKEN_PROGRAM_ID
  );
  console.log(`SPLToken: createMint ${mintAddr}`);

  for (const { acc, amount } of airdrops) {
    const tokenAccount = await spltoken.getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintAddr,
      acc.publicKey
    );
    // anchor.web3.Keypair.fromSecretKey
    // anchor.utils.bytes.bs58.decode
    anchor.utils.bytes.bs58;
    console.log(
      `SPLToken: token-account(${mintAddr}, ${acc.publicKey}) => ${tokenAccount}`
    );
    await spltoken.mintTo(
      connection,
      payer,
      mintAddr,
      tokenAccount.address,
      payer, // mint authority
      amount
    );
    console.log(`SPLToken: mintTo(${mintAddr}, ${acc.publicKey}) => ${amount}`);
    // const accountData = await spltoken.getAccount(connection, tokenAccount.address);
    const accountData = await spltoken.getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintAddr,
      acc.publicKey
    );
    console.log(
      `SPLToken: token-amount(${mintAddr}, ${acc.publicKey}) => ${accountData.amount}`
    );
  }
  return mintAddr;
}
