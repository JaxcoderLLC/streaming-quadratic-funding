import { useState, useEffect } from "react";
import {
  Framework,
  NativeAssetSuperToken,
  WrapperSuperToken,
  Operation,
} from "@superfluid-finance/sdk-core";
import { useNetwork } from "wagmi";
import { useEthersSigner, useEthersProvider } from "./ethersAdapters";

export default function useSuperfluid(tokenAddress: string, account?: string) {
  const [sfFramework, setSfFramework] = useState<Framework>();
  const [superToken, setSuperToken] = useState<
    NativeAssetSuperToken | WrapperSuperToken
  >();
  const [accountFlowRate, setAccountFlowRate] = useState("0");
  const [startingSuperTokenBalance, setStartingSuperTokenBalance] = useState({
    availableBalance: "0",
    timestamp: 0,
  });

  const { chain } = useNetwork();
  const signer = useEthersSigner();
  const provider = useEthersProvider();

  useEffect(() => {
    (async () => {
      if (!chain || !account) {
        return;
      }

      let superToken: NativeAssetSuperToken | WrapperSuperToken | null = null;

      const sfFramework = await Framework.create({
        chainId: chain.id,
        provider,
      });

      if (tokenAddress === "ETHx") {
        superToken = await sfFramework.loadNativeAssetSuperToken(tokenAddress);
      } else {
        superToken = await sfFramework.loadWrapperSuperToken(tokenAddress);
      }
      const accountFlowRate = await superToken.getNetFlow({
        account,
        providerOrSigner: provider,
      });
      const timestamp = (Date.now() / 1000) | 0;
      const { availableBalance, timestamp: startingDate } =
        await superToken.realtimeBalanceOf({
          account,
          timestamp,
          providerOrSigner: provider,
        });

      setSuperToken(superToken);
      setSfFramework(sfFramework);
      setAccountFlowRate(accountFlowRate);
      setStartingSuperTokenBalance({
        availableBalance,
        timestamp: (new Date(startingDate).getTime() / 1000) | 0,
      });
    })();
  }, [chain, account]);

  const getFlow = async (
    superToken: NativeAssetSuperToken | WrapperSuperToken,
    sender: string,
    receiver: string
  ) => {
    if (!superToken) {
      throw Error("Super Token was not initialized");
    }

    const flow = await superToken.getFlow({
      sender,
      receiver,
      providerOrSigner: provider,
    });

    return flow;
  };

  const wrap = async (amount: bigint) => {
    if (!superToken) {
      throw Error("Super Token was not initialized");
    }

    const op = superToken.upgrade({ amount: amount.toString() });

    await execTransaction(op);
  };

  const createFlow = async (
    sender: string,
    receiver: string,
    flowRate: string
  ) => {
    if (!superToken) {
      throw Error("Super Token was not initialized");
    }

    const op = superToken.createFlow({
      sender,
      receiver,
      flowRate,
    });

    await execTransaction(op);
  };

  const updateFlow = async (
    sender: string,
    receiver: string,
    flowRate: string
  ) => {
    if (!superToken) {
      throw Error("Super Token was not initialized");
    }

    const op = superToken.updateFlow({
      sender,
      receiver,
      flowRate,
    });

    await execTransaction(op);
  };

  const execTransaction = async (op: Operation) => {
    if (!signer) {
      throw Error("No signer was found");
    }

    const tx = await op.exec(signer);

    await tx.wait();
  };

  return {
    sfFramework,
    superToken,
    startingSuperTokenBalance,
    accountFlowRate,
    getFlow,
    wrap,
    createFlow,
    updateFlow,
  };
}
