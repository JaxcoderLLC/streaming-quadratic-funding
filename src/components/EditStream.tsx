import { useState, useMemo, useEffect } from "react";
import { useAccount, useNetwork, useBalance, useContractRead } from "wagmi";
import { formatEther, parseEther, formatUnits, Address } from "viem";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import Accordion from "react-bootstrap/Accordion";
import Stack from "react-bootstrap/Stack";
import Card from "react-bootstrap/Card";
import Dropdown from "react-bootstrap/Dropdown";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Image from "react-bootstrap/Image";
import Badge from "react-bootstrap/Badge";
import Tooltip from "react-bootstrap/Tooltip";
import Spinner from "react-bootstrap/Spinner";
import Alert from "react-bootstrap/Alert";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import ConnectWallet from "./ConnectWallet";
import CopyTooltip from "./CopyTooltip";
import OnRampWidget from "./OnRampWidget";
import InfoIcon from "../assets/info.svg";
import OpLogo from "../assets/op-logo.svg";
import ETHLogo from "../assets/eth-white.svg";
import DAILogo from "../assets/dai-white.svg";
import DoneIcon from "../assets/done.svg";
import XIcon from "../assets/x-logo.svg";
import SwapIcon from "../assets/swap.svg";
import LensIcon from "../assets/lens.svg";
import FarcasterIcon from "../assets/farcaster.svg";
import PassportIcon from "../assets/passport.svg";
import ArrowDownIcon from "../assets/arrow-down.svg";
import ArrowForwardIcon from "../assets/arrow-forward.svg";
import CopyIcon from "../assets/copy-light.svg";
import SuccessIcon from "../assets/success.svg";
import ReloadIcon from "../assets/reload.svg";
import { MatchingData } from "../components/StreamingQuadraticFunding";
import useFlowingAmount from "../hooks/flowingAmount";
import useSuperfluid from "../hooks/superfluid";
import useTransactionsQueue from "../hooks/transactionsQueue";
import useAllo from "../hooks/allo";
import useRoundQuery from "../hooks/roundQuery";
import { passportDecoderAbi } from "../lib/abi/passportDecoder";
import {
  TimeInterval,
  unitOfTime,
  isNumber,
  fromTimeUnitsToSeconds,
  truncateStr,
  roundWeiAmount,
  convertStreamValueToInterval,
  sqrtBigInt,
} from "../lib/utils";
import {
  DAI_ADDRESS,
  DAIX_ADDRESS,
  ETHX_ADDRESS,
  SQF_STRATEGY_ADDRESS,
} from "../lib/constants";

interface EditStreamProps {
  granteeName: string;
  granteeIndex: number | null;
  matchingData?: MatchingData;
  receiver: string;
  flowRateToReceiver: string;
  newFlowRate: string;
  setNewFlowRate: React.Dispatch<React.SetStateAction<string>>;
  transactionsToQueue: (() => Promise<void>)[];
  isFundingMatchingPool: boolean;
}

enum Step {
  SELECT_AMOUNT = "Edit stream",
  WRAP = "Wrap to Super Token",
  TOP_UP = "Top up required tokens",
  REVIEW = "Review the transaction(s)",
  MINT_PASSPORT = "Mint Gitcoin Passport",
  SUCCESS = "Success!",
}

dayjs().format();
dayjs.extend(duration);

export default function EditStream(props: EditStreamProps) {
  const {
    granteeName,
    granteeIndex,
    matchingData,
    flowRateToReceiver,
    newFlowRate,
    setNewFlowRate,
    transactionsToQueue,
    isFundingMatchingPool,
    receiver,
  } = props;

  const [wrapAmount, setWrapAmount] = useState<string | null>(null);
  const [underlyingTokenAllowance, setUnderlyingTokenAllowance] =
    useState<string>("0");
  const [step, setStep] = useState(Step.SELECT_AMOUNT);
  const [amountPerTimeInterval, setAmountPerTimeInterval] = useState("");
  const [timeInterval, setTimeInterval] = useState<TimeInterval>(
    TimeInterval.MONTH,
  );

  const { address } = useAccount();
  const { chain } = useNetwork();
  const { passportDecoder } = useAllo();
  const { userTokenSnapshots } = useRoundQuery(address);
  const {
    superToken,
    getUnderlyingTokenAllowance,
    updatePermissions,
    wrap,
    underlyingTokenApprove,
  } = useSuperfluid(isFundingMatchingPool ? "ETHx" : DAIX_ADDRESS, address);
  const userTokenSnapshot = userTokenSnapshots?.filter((snapshot) =>
    isFundingMatchingPool
      ? snapshot.token === ETHX_ADDRESS.toLowerCase()
      : snapshot.token === DAIX_ADDRESS.toLowerCase(),
  )[0];
  const accountFlowRate = userTokenSnapshot?.totalNetFlowRate ?? "0";
  const superTokenBalance = useFlowingAmount(
    BigInt(userTokenSnapshot?.balanceUntilUpdatedAt ?? 0),
    userTokenSnapshot?.updatedAtTimestamp ?? 0,
    BigInt(accountFlowRate),
  );
  const { data: underlyingTokenBalance } = useBalance({
    address,
    cacheTime: 10000,
    staleTime: 10000,
    watch: true,
    token: isFundingMatchingPool ? void 0 : DAI_ADDRESS,
  });
  const { data: ethBalance } = useBalance({
    address,
    cacheTime: 10000,
    staleTime: 10000,
    watch: true,
  });
  const {
    areTransactionsLoading,
    completedTransactions,
    transactionError,
    executeTransactions,
  } = useTransactionsQueue();
  const { data: passportScore, refetch: refetchPassportScore } =
    useContractRead({
      abi: passportDecoderAbi,
      address: passportDecoder?.address ?? "0x",
      functionName: "getScore",
      args: [address as Address],
      enabled: address ? true : false,
      watch: false,
    });

  const minEthBalance = 0.002;
  const suggestedTokenBalance = newFlowRate
    ? BigInt(newFlowRate) *
      BigInt(fromTimeUnitsToSeconds(1, unitOfTime[TimeInterval.MONTH])) *
      BigInt(3)
    : BigInt(0);
  const hasSufficientEthBalance =
    ethBalance && ethBalance.value > parseEther(minEthBalance.toString());
  const hasSuggestedTokenBalance =
    underlyingTokenBalance &&
    (underlyingTokenBalance.value > suggestedTokenBalance ||
      superTokenBalance > suggestedTokenBalance)
      ? true
      : false;
  const hasSufficientTokenBalance =
    underlyingTokenBalance &&
    underlyingTokenBalance.value + superTokenBalance > BigInt(0)
      ? true
      : false;
  const superTokenSymbol = isFundingMatchingPool ? "ETHx" : "DAIx";
  const superTokenIcon = isFundingMatchingPool ? ETHLogo : DAILogo;
  const underlyingTokenName = isFundingMatchingPool ? "ETH" : "DAI";
  const isDeletingStream =
    BigInt(flowRateToReceiver) > 0 && BigInt(newFlowRate) <= 0;

  const liquidationEstimate = useMemo(() => {
    if (address) {
      const newFlowRate =
        parseEther(amountPerTimeInterval) /
        BigInt(fromTimeUnitsToSeconds(1, unitOfTime[timeInterval]));

      if (
        BigInt(-accountFlowRate) - BigInt(flowRateToReceiver) + newFlowRate >
        BigInt(0)
      ) {
        const updatedAtTimestamp = userTokenSnapshot
          ? userTokenSnapshot.updatedAtTimestamp * 1000
          : Date.now();
        const date = dayjs(new Date(updatedAtTimestamp));

        return date
          .add(
            dayjs.duration({
              seconds: Number(
                (BigInt(userTokenSnapshot?.balanceUntilUpdatedAt ?? "0") +
                  parseEther(wrapAmount ?? "0")) /
                  (BigInt(-accountFlowRate) -
                    BigInt(flowRateToReceiver) +
                    newFlowRate),
              ),
            }),
          )
          .unix();
      }
    }

    return null;
  }, [
    userTokenSnapshot,
    accountFlowRate,
    address,
    wrapAmount,
    flowRateToReceiver,
    amountPerTimeInterval,
    timeInterval,
  ]);

  const netImpact = useMemo(() => {
    if (
      granteeIndex === null ||
      !matchingData ||
      !flowRateToReceiver ||
      !newFlowRate
    ) {
      return BigInt(0);
    }

    const scaledPreviousFlowRate = BigInt(flowRateToReceiver) / BigInt(1e6);
    const scaledNewFlowRate = BigInt(newFlowRate) / BigInt(1e6);
    const granteeUnits = BigInt(matchingData.members[granteeIndex].units);
    const granteeFlowRate = BigInt(matchingData.members[granteeIndex].flowRate);
    const newGranteeUnits =
      (sqrtBigInt(granteeUnits * BigInt(1e5)) -
        sqrtBigInt(BigInt(scaledPreviousFlowRate)) +
        sqrtBigInt(BigInt(scaledNewFlowRate))) **
        BigInt(2) /
      BigInt(1e5);
    const unitsDelta = newGranteeUnits - granteeUnits;
    const newPoolUnits = unitsDelta + BigInt(matchingData.totalUnits);
    const newGranteeFlowRate =
      (newGranteeUnits * BigInt(matchingData.flowRate)) / newPoolUnits;
    const netImpact = newGranteeFlowRate - granteeFlowRate;

    return netImpact;
  }, [newFlowRate, flowRateToReceiver, matchingData]);

  const transactions = useMemo(() => {
    if (!address || !superToken) {
      return [];
    }

    const wrapAmountWei = parseEther(wrapAmount ?? "0");
    const approvalTransactionsCount =
      !isFundingMatchingPool && wrapAmountWei > BigInt(underlyingTokenAllowance)
        ? 1
        : 0;
    const transactions: (() => Promise<void>)[] = [];

    if (wrapAmount && Number(wrapAmount) > 0) {
      if (!isFundingMatchingPool && approvalTransactionsCount > 0) {
        transactions.push(async () => {
          await underlyingTokenApprove(wrapAmountWei.toString());
        });
      }

      transactions.push(async () => await wrap(wrapAmountWei));
    }

    if (
      !isFundingMatchingPool &&
      BigInt(newFlowRate) > BigInt(flowRateToReceiver)
    ) {
      transactions.push(async () => {
        await updatePermissions(
          SQF_STRATEGY_ADDRESS,
          BigInt(newFlowRate).toString(),
        );
      });
    }

    transactions.push(...transactionsToQueue);

    return transactions;
  }, [address, superToken, wrapAmount, newFlowRate]);

  useEffect(() => {
    (async () => {
      if (superToken && !isFundingMatchingPool) {
        const underlyingTokenAllowance =
          await getUnderlyingTokenAllowance(superToken);

        setUnderlyingTokenAllowance(underlyingTokenAllowance);
      }
    })();
  }, [superToken]);

  useEffect(() => {
    (async () => {
      const currentStreamValue = roundWeiAmount(
        BigInt(flowRateToReceiver) *
          BigInt(fromTimeUnitsToSeconds(1, unitOfTime[timeInterval])),
        4,
      );

      setAmountPerTimeInterval(currentStreamValue);
    })();
  }, [address, receiver, flowRateToReceiver]);

  useEffect(() => {
    if (!areTransactionsLoading && amountPerTimeInterval) {
      if (
        Number(amountPerTimeInterval) > 0 &&
        liquidationEstimate &&
        dayjs
          .unix(liquidationEstimate)
          .isBefore(dayjs().add(dayjs.duration({ months: 3 })))
      ) {
        setWrapAmount(
          formatEther(parseEther(amountPerTimeInterval) * BigInt(3)),
        );
      } else {
        setWrapAmount("");
      }

      setNewFlowRate(
        (
          parseEther(amountPerTimeInterval) /
          BigInt(fromTimeUnitsToSeconds(1, unitOfTime[timeInterval]))
        ).toString(),
      );
    }
  }, [amountPerTimeInterval, timeInterval, areTransactionsLoading]);

  const handleAmountSelection = (
    e: React.ChangeEvent<HTMLInputElement>,
    setAmount: (value: string) => void,
  ) => {
    const { value } = e.target;

    if (isNumber(value) || value === "") {
      setAmount(value);
    } else if (value === ".") {
      setAmount("0.");
    }
  };

  const handleSubmit = async () => {
    await executeTransactions(transactions);

    setStep(Step.SUCCESS);
  };

  if (!passportDecoder) {
    return (
      <>
        <Spinner
          animation="border"
          role="status"
          className="mx-auto mt-5 p-3"
        ></Spinner>
        <Card.Text className="text-center">
          Waiting for passport details...
        </Card.Text>
      </>
    );
  }

  const { minPassportScore } = passportDecoder;

  return (
    <Accordion activeKey={step}>
      <Card className="bg-blue text-white rounded-0 rounded-top-4 border-0 border-bottom border-purple">
        <Button
          variant="transparent"
          className="d-flex align-items-center gap-2 p-3 text-white border-0 rounded-0 shadow-none"
          style={{
            pointerEvents: step === Step.SELECT_AMOUNT ? "none" : "auto",
          }}
          onClick={() => setStep(Step.SELECT_AMOUNT)}
        >
          <Badge
            pill
            as="div"
            className={`d-flex justify-content-center p-0 ${
              step !== Step.SELECT_AMOUNT ? "bg-info" : "bg-aqua"
            }`}
            style={{
              width: 20,
              height: 20,
            }}
          >
            {step !== Step.SELECT_AMOUNT ? (
              <Image src={DoneIcon} alt="done" width={16} />
            ) : (
              <Card.Text className="m-auto text-blue">1</Card.Text>
            )}
          </Badge>
          {Step.SELECT_AMOUNT}
        </Button>
        <Accordion.Collapse eventKey={Step.SELECT_AMOUNT} className="p-3 pt-0">
          <Stack gap={3}>
            <Stack direction="horizontal" gap={2}>
              <Badge className="d-flex align-items-center gap-1 bg-purple w-50 rounded-3 px-3 py-2 fs-4 fw-normal">
                <Image src={OpLogo} alt="optimism" width={18} />
                {chain?.id === 10 ? "OP Mainnet" : "OP Sepolia"}
              </Badge>
              <Badge className="d-flex align-items-center gap-1 bg-purple w-50 rounded-3 px-3 py-2 fs-4 fw-normal">
                <Image
                  src={superTokenIcon}
                  alt="optimism"
                  width={isFundingMatchingPool ? 12 : 18}
                />
                {superTokenSymbol}
              </Badge>
            </Stack>
            <Stack direction="horizontal">
              <Form.Control
                type="text"
                placeholder="0"
                disabled={!address || !flowRateToReceiver}
                value={amountPerTimeInterval}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleAmountSelection(e, setAmountPerTimeInterval)
                }
                className="bg-purple w-50 border-0 rounded-end-0 text-white shadow-none"
              />
              <Dropdown className="w-50">
                <Dropdown.Toggle
                  variant="blue"
                  className="d-flex justify-content-between align-items-center w-100 bg-purple border-0 rounded-start-0 fs-4"
                >
                  {timeInterval}
                </Dropdown.Toggle>
                <Dropdown.Menu variant="dark" className="bg-purple">
                  <Dropdown.Item
                    className="text-white"
                    onClick={() => {
                      setAmountPerTimeInterval(
                        convertStreamValueToInterval(
                          parseEther(amountPerTimeInterval),
                          timeInterval,
                          TimeInterval.DAY,
                        ),
                      );
                      setTimeInterval(TimeInterval.DAY);
                    }}
                  >
                    {TimeInterval.DAY}
                  </Dropdown.Item>
                  <Dropdown.Item
                    className="text-white"
                    onClick={() => {
                      setAmountPerTimeInterval(
                        convertStreamValueToInterval(
                          parseEther(amountPerTimeInterval),
                          timeInterval,
                          TimeInterval.WEEK,
                        ),
                      );
                      setTimeInterval(TimeInterval.WEEK);
                    }}
                  >
                    {TimeInterval.WEEK}
                  </Dropdown.Item>
                  <Dropdown.Item
                    className="text-white"
                    onClick={() => {
                      setAmountPerTimeInterval(
                        convertStreamValueToInterval(
                          parseEther(amountPerTimeInterval),
                          timeInterval,
                          TimeInterval.MONTH,
                        ),
                      );
                      setTimeInterval(TimeInterval.MONTH);
                    }}
                  >
                    {TimeInterval.MONTH}
                  </Dropdown.Item>
                  <Dropdown.Item
                    className="text-white"
                    onClick={() => {
                      setAmountPerTimeInterval(
                        convertStreamValueToInterval(
                          parseEther(amountPerTimeInterval),
                          timeInterval,
                          TimeInterval.YEAR,
                        ),
                      );
                      setTimeInterval(TimeInterval.YEAR);
                    }}
                  >
                    {TimeInterval.YEAR}
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </Stack>
            {address ? (
              <Button
                variant={isDeletingStream ? "danger" : "success"}
                disabled={
                  !amountPerTimeInterval ||
                  Number(amountPerTimeInterval) < 0 ||
                  (BigInt(flowRateToReceiver) === BigInt(0) &&
                    Number(amountPerTimeInterval) === 0) ||
                  newFlowRate === flowRateToReceiver
                }
                className="py-1 rounded-3 text-white"
                onClick={() =>
                  setStep(
                    !hasSufficientEthBalance || !hasSuggestedTokenBalance
                      ? Step.TOP_UP
                      : wrapAmount
                      ? Step.WRAP
                      : isFundingMatchingPool ||
                        (passportScore && passportScore >= minPassportScore)
                      ? Step.REVIEW
                      : Step.MINT_PASSPORT,
                  )
                }
              >
                {isDeletingStream ? "Cancel Stream" : "Continue"}
              </Button>
            ) : (
              <ConnectWallet />
            )}
          </Stack>
        </Accordion.Collapse>
      </Card>
      <Card className="bg-blue text-white rounded-0 border-0 border-bottom border-purple">
        <Button
          variant="transparent"
          className="d-flex align-items-center gap-2 p-3 border-0 rounded-0 text-white shadow-none"
          onClick={() => setStep(Step.TOP_UP)}
          style={{
            pointerEvents:
              step === Step.SELECT_AMOUNT ||
              step === Step.TOP_UP ||
              step === Step.SUCCESS
                ? "none"
                : "auto",
          }}
        >
          <Badge
            pill
            as="div"
            className={`d-flex justify-content-center p-0
                    ${
                      step === Step.SELECT_AMOUNT
                        ? "bg-secondary"
                        : step === Step.TOP_UP
                        ? "bg-aqua"
                        : "bg-info"
                    }`}
            style={{
              width: 20,
              height: 20,
            }}
          >
            {step !== Step.SELECT_AMOUNT && step !== Step.TOP_UP ? (
              <Image src={DoneIcon} alt="done" width={16} />
            ) : (
              <Card.Text className="m-auto text-blue">2</Card.Text>
            )}
          </Badge>
          {Step.TOP_UP}
        </Button>
        <Accordion.Collapse eventKey={Step.TOP_UP} className="p-3 pt-0">
          <>
            {isFundingMatchingPool ? (
              <Stack
                direction="vertical"
                gap={3}
                className="align-items-center w-50 bg-dark px-2 py-3 rounded-3 m-auto"
              >
                <Card.Text className="m-0 fs-5">ETH Balance:</Card.Text>
                <Card.Text
                  className={`d-flex align-items-center gap-1 m-0 fs-3 ${
                    !ethBalance || ethBalance.value === BigInt(0)
                      ? "text-danger"
                      : !hasSuggestedTokenBalance
                      ? "text-yellow"
                      : "text-white"
                  }`}
                >
                  {ethBalance
                    ? formatEther(ethBalance.value + superTokenBalance).slice(
                        0,
                        8,
                      )
                    : "0"}
                  {hasSuggestedTokenBalance && (
                    <Image src={SuccessIcon} alt="success" />
                  )}
                </Card.Text>
                <Card.Text className="m-0 fs-6">
                  At least {roundWeiAmount(suggestedTokenBalance, 6)} suggested
                </Card.Text>
                <OnRampWidget />
              </Stack>
            ) : (
              <Stack direction="horizontal" gap={3}>
                <Stack
                  direction="vertical"
                  gap={3}
                  className="align-items-center w-50 bg-dark px-2 py-3 rounded-3"
                >
                  <Card.Text className="m-0 fs-5">ETH Balance:</Card.Text>
                  <Card.Text
                    className={`d-flex align-items-center gap-1 m-0 fs-3 ${
                      hasSufficientEthBalance ? "text-white" : "text-danger"
                    }`}
                  >
                    {ethBalance ? ethBalance.formatted.slice(0, 8) : "0"}
                    {hasSufficientEthBalance && (
                      <Image src={SuccessIcon} alt="success" />
                    )}
                  </Card.Text>
                  <Card.Text className="m-0 fs-6">
                    At least {minEthBalance} needed for gas
                  </Card.Text>
                  <OnRampWidget />
                </Stack>
                <Stack
                  direction="vertical"
                  gap={3}
                  className="align-items-center w-50 bg-dark px-2 py-3 rounded-3 fs-5"
                >
                  <Card.Text className="m-0 fs-5">
                    DAI + DAIx Balance:
                  </Card.Text>
                  <Card.Text
                    className={`d-flex align-items-center gap-1 m-0 fs-3 ${
                      hasSuggestedTokenBalance
                        ? "text-white"
                        : !underlyingTokenBalance ||
                          underlyingTokenBalance.value + superTokenBalance ===
                            BigInt(0)
                        ? "text-danger"
                        : "text-yellow"
                    }`}
                  >
                    {underlyingTokenBalance
                      ? formatEther(
                          underlyingTokenBalance.value + superTokenBalance,
                        ).slice(0, 8)
                      : "0"}
                    {hasSuggestedTokenBalance && (
                      <Image src={SuccessIcon} alt="success" />
                    )}
                  </Card.Text>
                  <Card.Text className="m-0 fs-6">
                    At least {roundWeiAmount(suggestedTokenBalance, 6)} to
                    donate suggested
                  </Card.Text>
                  <Button
                    variant="link"
                    href="https://swap.defillama.com/?chain=optimism&from=0x0000000000000000000000000000000000000000&to=0xda10009cbd5d07dd0cecc66161fc93d7c9000da1"
                    target="_blank"
                    rel="noreferrer"
                    className="d-flex justify-content-center gap-1 bg-primary text-decoration-none rounded-3 text-white fs-4"
                  >
                    <Image src={SwapIcon} alt="swap" width={18} />
                    Swap ETH
                  </Button>
                </Stack>
              </Stack>
            )}
            <Button
              variant="transparent"
              className="mt-4 text-info"
              onClick={() => setStep(Step.WRAP)}
            >
              Skip
            </Button>
            <Button
              variant="success"
              className="w-50 mt-4 py-1 rounded-3 text-white float-end"
              disabled={
                (!isFundingMatchingPool &&
                  (!hasSufficientEthBalance || !hasSufficientTokenBalance)) ||
                (isFundingMatchingPool &&
                  (!ethBalance ||
                    ethBalance.value + superTokenBalance === BigInt(0)))
              }
              onClick={() =>
                setStep(
                  wrapAmount
                    ? Step.WRAP
                    : isFundingMatchingPool ||
                      (passportScore && passportScore >= minPassportScore)
                    ? Step.REVIEW
                    : Step.MINT_PASSPORT,
                )
              }
            >
              Continue
            </Button>
          </>
        </Accordion.Collapse>
      </Card>
      <Card className="bg-blue text-white rounded-0 border-0 border-bottom border-purple">
        <Button
          variant="transparent"
          className="d-flex align-items-center gap-2 p-3 border-0 rounded-0 text-white shadow-none"
          onClick={() => setStep(Step.WRAP)}
          style={{
            pointerEvents:
              step === Step.REVIEW || step === Step.MINT_PASSPORT
                ? "auto"
                : "none",
          }}
        >
          <Badge
            pill
            as="div"
            className={`d-flex justify-content-center p-0
                    ${
                      step === Step.SELECT_AMOUNT || step === Step.TOP_UP
                        ? "bg-secondary"
                        : step === Step.WRAP
                        ? "bg-aqua"
                        : "bg-info"
                    }`}
            style={{
              width: 20,
              height: 20,
            }}
          >
            {step === Step.REVIEW ||
            step === Step.MINT_PASSPORT ||
            step === Step.SUCCESS ? (
              <Image src={DoneIcon} alt="done" width={16} />
            ) : (
              <Card.Text className="m-auto text-blue">3</Card.Text>
            )}
          </Badge>
          {Step.WRAP}
        </Button>
        <Accordion.Collapse eventKey={Step.WRAP} className="p-3 pt-0">
          <Stack direction="vertical" gap={3}>
            <Stack direction="vertical" className="position-relative">
              <Stack
                direction="horizontal"
                gap={2}
                className="w-100 bg-purple p-2 rounded-4 rounded-bottom-0"
              >
                <Form.Control
                  type="text"
                  placeholder="0"
                  disabled={!address}
                  value={wrapAmount ?? ""}
                  className="bg-purple w-75 border-0 text-white shadow-none"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleAmountSelection(e, setWrapAmount)
                  }
                />
                <Badge
                  as="div"
                  className="d-flex justify-content-center align-items-center w-25 gap-1 bg-dark py-2 border border-dark rounded-3"
                >
                  <Image
                    src={superTokenIcon}
                    alt="done"
                    width={isFundingMatchingPool ? 10 : 18}
                  />
                  <Card.Text className="p-0">{underlyingTokenName}</Card.Text>
                </Badge>
              </Stack>
              <Card.Text className="w-100 bg-purple m-0 mb-2 px-2 pb-2 rounded-bottom-4 text-end fs-5">
                Balance:{" "}
                {underlyingTokenBalance
                  ? underlyingTokenBalance.formatted.slice(0, 8)
                  : ""}
              </Card.Text>
              <Badge
                pill
                className="position-absolute top-50 start-50 translate-middle bg-dark p-1"
              >
                <Image src={ArrowDownIcon} alt="downward arrow" width={22} />
              </Badge>
              <Stack
                direction="horizontal"
                gap={2}
                className="w-100 bg-purple p-2 rounded-4 rounded-bottom-0"
              >
                <Form.Control
                  type="text"
                  placeholder="0"
                  disabled={!address}
                  value={wrapAmount ?? ""}
                  className="bg-purple w-75 border-0 text-white shadow-none"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleAmountSelection(e, setWrapAmount)
                  }
                />
                <Badge
                  as="div"
                  className="d-flex justify-content-center align-items-center gap-1 w-25 bg-dark py-2 border border-dark rounded-3"
                >
                  <Image
                    src={superTokenIcon}
                    alt="done"
                    width={isFundingMatchingPool ? 10 : 18}
                  />
                  <Card.Text className="p-0">{superTokenSymbol}</Card.Text>
                </Badge>
              </Stack>
              <Card.Text className="w-100 bg-purple m-0 px-2 pb-2 rounded-bottom-4 text-end fs-5">
                Balance: {formatEther(superTokenBalance).slice(0, 8)}
              </Card.Text>
            </Stack>
            {underlyingTokenBalance &&
              wrapAmount &&
              Number(
                formatUnits(
                  underlyingTokenBalance.value,
                  underlyingTokenBalance.decimals,
                ),
              ) < Number(wrapAmount) && (
                <Alert variant="danger" className="m-0">
                  Insufficient Balance
                </Alert>
              )}
            <Stack direction="horizontal" gap={2}>
              <OverlayTrigger
                overlay={
                  <Tooltip id="t-skip-wrap" className="fs-6">
                    You can skip wrapping if you already have an{" "}
                    {superTokenSymbol}
                    balance.
                  </Tooltip>
                }
              >
                <Button
                  variant="primary"
                  disabled={superTokenBalance <= BigInt(0)}
                  className="w-50 py-1 rounded-3 text-white"
                  onClick={() => {
                    setWrapAmount("");
                    setStep(
                      isFundingMatchingPool ||
                        (passportScore && passportScore >= 0)
                        ? Step.REVIEW
                        : Step.MINT_PASSPORT,
                    );
                  }}
                >
                  Skip
                </Button>
              </OverlayTrigger>
              <Button
                variant="success"
                disabled={
                  !underlyingTokenBalance ||
                  !wrapAmount ||
                  Number(wrapAmount) === 0 ||
                  Number(
                    formatUnits(
                      underlyingTokenBalance.value,
                      underlyingTokenBalance.decimals,
                    ),
                  ) < Number(wrapAmount)
                }
                className="w-50 py-1 rounded-3 text-white"
                onClick={() =>
                  setStep(
                    isFundingMatchingPool ||
                      (passportScore && passportScore >= minPassportScore)
                      ? Step.REVIEW
                      : Step.MINT_PASSPORT,
                  )
                }
              >
                Continue
              </Button>
            </Stack>
          </Stack>
        </Accordion.Collapse>
      </Card>
      {!isFundingMatchingPool && (
        <Card className="bg-blue text-white rounded-0 border-0 border-bottom border-purple">
          <Button
            variant="transparent"
            className="d-flex align-items-center gap-2 p-3 border-0 rounded-0 text-white shadow-none"
            style={{
              pointerEvents: step !== Step.REVIEW ? "none" : "auto",
            }}
            onClick={() => setStep(Step.MINT_PASSPORT)}
          >
            <Badge
              pill
              className={`d-flex justify-content-center p-0 ${
                step !== Step.MINT_PASSPORT &&
                step !== Step.REVIEW &&
                step !== Step.SUCCESS
                  ? "bg-secondary"
                  : step === Step.REVIEW || step === Step.SUCCESS
                  ? "bg-info"
                  : "bg-aqua"
              }`}
              style={{
                width: 20,
                height: 20,
              }}
            >
              {step === Step.REVIEW || step === Step.SUCCESS ? (
                <Image src={DoneIcon} alt="done" width={16} />
              ) : (
                <Card.Text className="m-auto text-blue">4</Card.Text>
              )}
            </Badge>
            {Step.MINT_PASSPORT}
          </Button>
          <Accordion.Collapse
            eventKey={Step.MINT_PASSPORT}
            className="p-3 py-0"
          >
            <Stack direction="vertical" gap={2}>
              <Card.Text className="m-0 border-bottom border-secondary text-secondary">
                Current Score
              </Card.Text>
              <Stack
                direction="horizontal"
                gap={3}
                className={`${
                  passportScore && passportScore >= 0
                    ? "text-success"
                    : passportScore
                    ? "text-danger"
                    : "text-yellow"
                }`}
              >
                <Image src={PassportIcon} alt="passport" width={36} />
                <Card.Text className="m-0 fs-1 fw-bold">
                  {passportScore
                    ? parseFloat((Number(passportScore) / 10000).toFixed(3))
                    : "N/A"}
                </Card.Text>
                <Card.Text className="m-0 fs-5" style={{ width: 80 }}>
                  min. {Number(0) / 10000} required for matching
                </Card.Text>
                <Button
                  variant="transparent"
                  className="p-0"
                  onClick={() => refetchPassportScore({ throwOnError: false })}
                >
                  <Image
                    src={ReloadIcon}
                    alt="reload"
                    width={24}
                    style={{
                      filter:
                        passportScore && passportScore >= 0
                          ? "invert(65%) sepia(44%) saturate(6263%) hue-rotate(103deg) brightness(95%) contrast(97%)"
                          : passportScore
                          ? "invert(27%) sepia(47%) saturate(3471%) hue-rotate(336deg) brightness(93%) contrast(85%)"
                          : "invert(88%) sepia(26%) saturate(4705%) hue-rotate(2deg) brightness(109%) contrast(102%)",
                    }}
                  />
                </Button>
              </Stack>
              <Button variant="secondary" className="w-100 rounded-3">
                <Card.Link
                  href="https://passport.gitcoin.co"
                  target="_blank"
                  rel="noreferrer"
                  className="text-decoration-none text-white fw-bold"
                >
                  Update stamps and mint
                </Card.Link>
              </Button>
              <Button
                variant="success"
                // disabled={!passportScore || passportScore <= 0}
                className="w-100 m-0 ms-auto mt-1 fs-4 text-white fw-bold"
                onClick={() => setStep(Step.REVIEW)}
              >
                Continue
              </Button>
            </Stack>
          </Accordion.Collapse>
        </Card>
      )}
      <Card className="bg-blue text-white rounded-0 rounded-bottom-4 border-0">
        <Button
          variant="transparent"
          className="d-flex align-items-center gap-2 p-3 border-0 rounded-0 text-white shadow-none"
          style={{
            pointerEvents: "none",
          }}
          onClick={() => setStep(Step.REVIEW)}
        >
          <Badge
            pill
            className={`d-flex justify-content-center p-0 ${
              step !== Step.REVIEW && step !== Step.SUCCESS
                ? "bg-secondary"
                : step === Step.SUCCESS
                ? "bg-info"
                : "bg-aqua"
            }`}
            style={{
              width: 20,
              height: 20,
            }}
          >
            {step === Step.SUCCESS ? (
              <Image src={DoneIcon} alt="done" width={16} />
            ) : (
              <Card.Text className="m-auto text-blue">
                {isFundingMatchingPool ? 4 : 5}
              </Card.Text>
            )}
          </Badge>
          {Step.REVIEW}
        </Button>
        <Accordion.Collapse eventKey={Step.REVIEW} className="p-3 pt-0">
          <Stack direction="vertical" gap={2}>
            {Number(wrapAmount) > 0 && (
              <Stack direction="vertical" gap={1}>
                <Card.Text className="border-bottom border-secondary mb-2 pb-1 text-secondary">
                  A. Wrap Tokens
                </Card.Text>
                <Stack
                  direction="horizontal"
                  gap={1}
                  className="position-relative"
                >
                  <Stack
                    direction="vertical"
                    gap={2}
                    className="justify-content-center align-items-center bg-purple p-2 rounded-4"
                  >
                    <Image
                      src={superTokenIcon}
                      alt="done"
                      width={isFundingMatchingPool ? 16 : 28}
                    />
                    <Card.Text className="m-0 border-0 text-center text-white fs-5">
                      {wrapAmount} <br /> {underlyingTokenName}
                    </Card.Text>
                    <Card.Text className="border-0 text-center text-white fs-6">
                      New Balance:{" "}
                      {(
                        Number(underlyingTokenBalance?.formatted) -
                        Number(wrapAmount)
                      )
                        .toString()
                        .slice(0, 8)}
                    </Card.Text>
                  </Stack>
                  <Image
                    className="bg-transparent"
                    src={ArrowForwardIcon}
                    alt="forward arrow"
                    width={30}
                  />
                  <Stack
                    direction="vertical"
                    gap={2}
                    className="justify-content-center align-items-center bg-purple p-2 rounded-4"
                  >
                    <Image
                      src={superTokenIcon}
                      alt="done"
                      width={isFundingMatchingPool ? 16 : 28}
                    />
                    <Card.Text className="m-0 border-0 text-center text-white fs-5">
                      {wrapAmount} <br /> {superTokenSymbol}
                    </Card.Text>
                    <Card.Text className="border-0 text-center text-white fs-6">
                      New Balance:{" "}
                      {formatEther(
                        superTokenBalance + parseEther(wrapAmount ?? "0"),
                      ).slice(0, 8)}
                    </Card.Text>
                  </Stack>
                </Stack>
                <Card.Text className="border-0 text-center text-gray fs-4">
                  1 {underlyingTokenName} = 1 {superTokenSymbol}
                </Card.Text>
              </Stack>
            )}
            <Stack direction="vertical" gap={1}>
              <Card.Text className="border-bottom border-secondary m-0 pb-1 text-secondary">
                {Number(wrapAmount) > 0 ? "B." : "A."} Edit stream
              </Card.Text>
            </Stack>
            <Stack
              direction="horizontal"
              className="justify-content-around px-2"
            >
              <Card.Text className="m-0 border-0 text-center text-white fs-4">
                Sender
              </Card.Text>
              <Card.Text className="m-0 border-0 text-center text-white fs-4">
                Receiver
              </Card.Text>
            </Stack>
            <Stack direction="horizontal">
              <Badge className="d-flex justify-content-around align-items-center w-50 bg-purple py-3 rounded-3 border-0 text-center text-white fs-5">
                {truncateStr(address ?? "", 12)}
                <CopyTooltip
                  contentClick="Address copied"
                  contentHover="Copy address"
                  handleCopy={() =>
                    navigator.clipboard.writeText(address ?? "")
                  }
                  target={<Image src={CopyIcon} alt="copy" width={18} />}
                />
              </Badge>
              <Image
                className="bg-transparent"
                src={ArrowForwardIcon}
                alt="forward arrow"
                width={30}
              />
              <Badge className="d-flex justify-content-around align-items-center w-50 bg-purple px-2 py-3 rounded-3 border-0 text-center text-white fs-5">
                {truncateStr(receiver, 12)}
                <CopyTooltip
                  contentClick="Address copied"
                  contentHover="Copy address"
                  handleCopy={() => navigator.clipboard.writeText(receiver)}
                  target={<Image src={CopyIcon} alt="copy" width={18} />}
                />
              </Badge>
            </Stack>
            <Stack direction="vertical">
              <Stack
                direction="horizontal"
                className={`mt-2 bg-purple p-2 ${
                  !isFundingMatchingPool ? "rounded-top-4" : "rounded-4"
                }`}
              >
                <Card.Text className="w-33 m-0">New Stream</Card.Text>
                <Stack direction="horizontal" gap={1} className="w-50 ms-1 p-2">
                  <Image
                    src={superTokenIcon}
                    alt={isFundingMatchingPool ? "eth" : "dai"}
                    width={isFundingMatchingPool ? 16 : 22}
                  />
                  <Badge className="bg-aqua w-100 ps-2 pe-2 py-2 fs-4 text-start">
                    {convertStreamValueToInterval(
                      parseEther(amountPerTimeInterval),
                      timeInterval,
                      TimeInterval.MONTH,
                    )}
                  </Badge>
                </Stack>
                <Card.Text className="m-0 ms-1 fs-5">/month</Card.Text>
              </Stack>
              {!isFundingMatchingPool && (
                <Stack
                  direction="horizontal"
                  className="bg-purple rounded-bottom-4 border-top border-dark p-2"
                >
                  <Card.Text className="w-33 m-0">Matching</Card.Text>
                  <Stack
                    direction="horizontal"
                    gap={1}
                    className="w-50 ms-1 p-2"
                  >
                    <Image
                      src={ETHLogo}
                      alt="eth"
                      width={18}
                      className="mx-1"
                    />
                    <Badge className="bg-slate w-100 ps-2 pe-2 py-2 fs-4 text-start">
                      {passportScore && passportScore < minPassportScore
                        ? "N/A"
                        : netImpact
                        ? `${netImpact > 0 ? "+" : ""}${parseFloat(
                            (
                              Number(formatEther(netImpact)) *
                              fromTimeUnitsToSeconds(1, "months")
                            ).toFixed(6),
                          )}`
                        : 0}
                    </Badge>
                  </Stack>
                  <Card.Text className="m-0 ms-1 fs-5">/month</Card.Text>
                </Stack>
              )}
            </Stack>
            {liquidationEstimate && (
              <Stack direction="horizontal" gap={1} className="mt-1">
                <Card.Text className="m-0">Est. Liquidation</Card.Text>
                <OverlayTrigger
                  overlay={
                    <Tooltip id="t-liquidation-info" className="fs-6">
                      This is the current estimate for when your token balance
                      will reach 0. Make sure to close your stream or wrap more
                      tokens before this date to avoid loss of your buffer
                      deposit.
                    </Tooltip>
                  }
                >
                  <Image src={InfoIcon} alt="liquidation info" width={16} />
                </OverlayTrigger>
                <Card.Text className="m-0 ms-1">
                  {dayjs.unix(liquidationEstimate).format("MMMM D, YYYY")}
                </Card.Text>
              </Stack>
            )}
            <Button
              variant={isDeletingStream ? "danger" : "success"}
              disabled={transactions.length === 0 || step === Step.SUCCESS}
              className="d-flex justify-content-center mt-2 py-1 rounded-3 text-white fw-bold"
              onClick={handleSubmit}
            >
              {areTransactionsLoading ? (
                <Stack
                  direction="horizontal"
                  gap={2}
                  className="justify-content-center"
                >
                  <Spinner
                    size="sm"
                    animation="border"
                    role="status"
                    className="p-2"
                  ></Spinner>
                  <Card.Text className="m-0">
                    {completedTransactions + 1}/{transactions.length}
                  </Card.Text>
                </Stack>
              ) : isDeletingStream ? (
                "Cancel Stream"
              ) : transactions.length > 0 ? (
                `Submit (${transactions.length})`
              ) : (
                "Submit"
              )}
            </Button>
            {transactionError && (
              <Alert
                variant="danger"
                className="mt-2 rounded-4 text-wrap text-break"
              >
                {transactionError}
              </Alert>
            )}
          </Stack>
        </Accordion.Collapse>
      </Card>
      {step === Step.SUCCESS && BigInt(newFlowRate) === BigInt(0) ? (
        <Card className="bg-blue mt-4 p-4 text-white rounded-4">
          <Card.Text>Your donation stream is closed.</Card.Text>
        </Card>
      ) : step === Step.SUCCESS ? (
        <Card className="bg-blue mt-4 p-4 text-white rounded-4">
          <Card.Text>
            Your donation stream is open. Thank you for supporting public goods!
          </Card.Text>
          <Card.Text
            as="span"
            className="text-center"
            style={{ fontSize: 100 }}
          >
            &#x1F64F;
          </Card.Text>
          <Card.Text>
            Help spread the word about Streaming Quadratic Funding by sharing
            your contribution with your network:
          </Card.Text>
          <Stack
            direction="horizontal"
            gap={3}
            className="justify-content-around align-items-end"
          >
            <Card.Link
              className="d-flex flex-column align-items-center twitter-share-button text-decoration-none text-white fs-5 m-0 w-33"
              rel="noreferrer"
              target="_blank"
              href={`https://twitter.com/intent/tweet?text=I%20just%20opened%20a%20contribution%20stream%20to%20${granteeName}%20in%20the%20%23streamingquadratic%20funding%20pilot%20presented%20by%20%40thegeoweb%2C%20%40Superfluid_HQ%2C%20%26%20%40gitcoin%3A%0A%0Ahttps%3A%2F%2Fgeoweb.land%2Fgovernance%2F%0A%0AJoin%20me%20in%20making%20public%20goods%20funding%20history%20by%20donating%20in%20the%20world%27s%20first%20SQF%20round%21`}
              data-size="large"
            >
              <Image src={XIcon} alt="x social" width={28} />
              Post to X
            </Card.Link>
            <Card.Link
              className="d-flex flex-column align-items-center text-decoration-none text-white fs-5 m-0 w-50"
              rel="noreferrer"
              target="_blank"
              href={`https://warpcast.com/~/compose?text=I+just+opened+a+contribution+stream+to+${granteeName}+in+the+%23streamingquadraticfunding+pilot+round+presented+by+%40geoweb%2C+%40gitcoin%2C+%26+Superfluid%3A+%0A%0Ahttps%3A%2F%2Fgeoweb.land%2Fgovernance%2F+%0A%0AJoin+me+in+making+public+goods+funding+history+by+donating+in+the+world's+first+SQF+round%21`}
            >
              <Image src={FarcasterIcon} alt="farcaster" width={28} />
              Cast to Farcaster
            </Card.Link>
            <Card.Link
              className="d-flex flex-column align-items-center text-decoration-none text-white fs-5 m-0 w-33"
              rel="noreferrer"
              target="_blank"
              href={`https://hey.xyz/?text=I+just+opened+a+contribution+stream+to+GRANTEE+in+the+%23streamingquadraticfunding+pilot+round+presented+by+%40geoweb%2C+%40gitcoin%2C+%26+%40superfluid%3A+%0A%0Ahttps%3A%2F%2Fgeoweb.land%2Fgovernance%2F+%0A%0AJoin+me+in+making+public+goods+funding+history+by+donating+in+the+world%27s+first+SQF+round%21`}
            >
              <Image src={LensIcon} alt="lens" width={28} />
              Post on Lens
            </Card.Link>
          </Stack>
        </Card>
      ) : null}
    </Accordion>
  );
}
