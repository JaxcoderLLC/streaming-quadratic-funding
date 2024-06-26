import { useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { Address } from "viem";
import Stack from "react-bootstrap/Stack";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Image from "react-bootstrap/Image";
import Offcanvas from "react-bootstrap/Offcanvas";
import RecipientDetails from "./RecipientDetails";
import EditStream from "./EditStream";
import CloseIcon from "../assets/close.svg";
import useAllo from "../hooks/allo";
import useSuperfluid from "../hooks/superfluid";
import {
  TransactionPanelState,
  AllocationData,
  MatchingData,
} from "./StreamingQuadraticFunding";
import { DAIX_ADDRESS } from "../lib/constants";

export type FundGranteeProps = {
  setTransactionPanelState: React.Dispatch<
    React.SetStateAction<TransactionPanelState>
  >;
  userAllocationData: AllocationData[];
  directAllocationData: AllocationData[];
  matchingData: MatchingData;
  granteeIndex: number;
  name: string;
  image: string;
  website: string;
  social: string;
  granteeAddress: Address;
  description: string;
  recipientId: Address;
};

export default function FundGrantee(props: FundGranteeProps) {
  const {
    recipientId,
    granteeAddress,
    name,
    setTransactionPanelState,
    userAllocationData,
    granteeIndex,
  } = props;

  const [newFlowRate, setNewFlowRate] = useState("");

  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { alloStrategy, recipients } = useAllo();
  const { deleteFlow } = useSuperfluid(DAIX_ADDRESS, address);

  const allocate = async () => {
    if (!walletClient) {
      return;
    }
    const allocationData = alloStrategy.getAllocationData(
      recipientId,
      BigInt(newFlowRate)
    );
    const hash = await walletClient.sendTransaction({
      account: walletClient.account,
      data: allocationData.data,
      to: allocationData.to as Address,
      value: BigInt(allocationData.value),
    });

    await publicClient.waitForTransactionReceipt({
      hash,
    });
  };

  const closeOffcanvas = () =>
    setTransactionPanelState({
      show: false,
      isMatchingPool: false,
      granteeIndex: null,
    });

  return (
    <Offcanvas
      show
      scroll
      onHide={closeOffcanvas}
      placement="end"
      backdrop={false}
      className="w-25 bg-dark px-3 overflow-auto border-0 border-top border-secondary border-opacity-25"
      style={{ top: 62 }}
    >
      <Stack
        direction="horizontal"
        className="justify-content-between align-items-center py-2 text-white"
      >
        <Card.Text className="fs-3 pe-0 m-0">Fund Candidate</Card.Text>
        <Button
          variant="transparent"
          className="position-absolute end-0 px-2 me-1 py-0"
          onClick={closeOffcanvas}
        >
          <Image src={CloseIcon} alt="close" width={28} />
        </Button>
      </Stack>
      <Stack
        direction="vertical"
        gap={4}
        className="flex-grow-0 rounded-4 text-white pb-3"
      >
        <RecipientDetails
          flowRateToReceiver={userAllocationData[granteeIndex].flowRate}
          {...props}
        />
        <EditStream
          receiver={granteeAddress}
          granteeName={name}
          flowRateToReceiver={userAllocationData[granteeIndex].flowRate}
          newFlowRate={newFlowRate}
          setNewFlowRate={setNewFlowRate}
          isFundingMatchingPool={false}
          transactionsToQueue={[
            BigInt(newFlowRate) > 0
              ? allocate
              : () =>
                  deleteFlow(
                    recipients ? recipients[granteeIndex].superApp : "0x"
                  ),
          ]}
          {...props}
        />
      </Stack>
    </Offcanvas>
  );
}
