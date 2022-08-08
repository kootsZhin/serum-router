import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { SerumRouter } from "../target/types/serum_router";

describe("serum-router", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SerumRouter as Program<SerumRouter>;

  it("Set up completed!", async () => { });
});