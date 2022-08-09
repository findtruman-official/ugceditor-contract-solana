import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { assert } from "chai";
import { SolanaPrograms } from "../target/types/solana_programs";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Metaplex } from "@metaplex-foundation/js";

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

  it("Is initialized!", async () => {
    await airdropSOL({
      provider: anchor.getProvider(),
      target: manager.publicKey,
      amount: anchor.web3.LAMPORTS_PER_SOL,
    });

    factory = (
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from(anchor.utils.bytes.utf8.encode("factory"))],
        program.programId
      )
    )[0];

    // Add your test here.

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
    await program.methods
      .publishStoryNft(
        storyId,
        new anchor.BN(200),
        new anchor.BN(5000),
        new anchor.BN(1200),
        "IMAGE",
        "TITLE",
        "DESCRIPTION"
      )
      .accounts({
        author: author.publicKey,
        story: await getStoryKey(storyId),
        mintState: await getMintStateKey(storyId),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([author])
      .rpc({});

    const mintStateData = await program.account.storyNftMintState.fetch(
      await getMintStateKey(storyId)
    );
    assert.equal(mintStateData.description, "DESCRIPTION");
    assert.equal(mintStateData.image, "IMAGE");
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

    const NftTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      minter.publicKey
    );
    console.log(`NFT TOKEN ACCOUNT ${NftTokenAccount}`);
    // const mint_tx = new anchor.web3.Transaction().add(
    //   anchor.web3.SystemProgram.createAccount({
    //     fromPubkey: minter.publicKey,
    //     newAccountPubkey: mint.publicKey,
    //     space: MINT_SIZE,
    //     programId: TOKEN_PROGRAM_ID,
    //     lamports,
    //   }),
    //   createInitializeMintInstruction(
    //     mint.publicKey,
    //     0,
    //     minter.publicKey,
    //     minter.publicKey
    //   ),
    //   createAssociatedTokenAccountInstruction(
    //     minter.publicKey,
    //     NftTokenAccount,
    //     minter.publicKey,
    //     minter.publicKey
    //   )
    // );
    // // Mint 是否可以用PDA账户？

    // const res = await program.provider.sendAndConfirm(mint_tx, [mint, minter]);
    // console.log(
    //   await program.provider.connection.getParsedAccountInfo(mint.publicKey)
    // );

    // console.log("Account: ", res);
    // console.log("Mint key: ", mint.publicKey.toString());
    // console.log("User: ", minter.publicKey.toString());
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
      })
      .signers([minter, mint])
      .rpc({});
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
