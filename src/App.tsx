import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import { allCards } from "./tarot";
import Container from "react-bootstrap/Container";
import Stack from "react-bootstrap/Stack";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import ProgressBar from "react-bootstrap/ProgressBar";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import { connectWallet, getWalletAddress, buyPack, refundPack } from "./escrow";
import Unity, { UnityContext } from "react-unity-webgl";

const browser = io("/browser");
const gameManager = "Main Camera";

const unityContext = new UnityContext({
  loaderUrl:    "build/webgl.loader.js",
  dataUrl:      "build/webgl.data",
  frameworkUrl: "build/webgl.framework.js",
  codeUrl:      "build/webgl.wasm",
});

function App() {
  const [isDevelopment, setIsDevelopment] = useState(false);
  const [progression, setProgresssion] = useState(0);
  const [pct, setPct] = useState(0);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [odds, setOdds] = useState([]);
  const [totals, setTotals] = useState([]);
  const [mintotals, setMinTotals] = useState(0);
  const [maxtotals, setMaxTotals] = useState(100);

  useEffect(() => {
    browser.on('isDevelopment', isDevelopment => setIsDevelopment(isDevelopment));
    browser.on('pct', (pct: number, label: string) => {
      setPct(pct);
      setLabel(label);
    });
    browser.on('error', error => {
      setError(error);
      unityContext.send(gameManager, "OnMsg", `Error: ${error}`);
    });
    browser.on('odds', odds => setOdds(odds));
    browser.on('totals', totals => {
      setMinTotals(Math.min(...totals));
      setMaxTotals(Math.max(...totals));
      setTotals(totals);
    });

    unityContext.on("progress", (progression) => setProgresssion(progression));
    unityContext.on("GetHostAddress", () => {
      const host = window.location.host;
      unityContext.send(gameManager, "SetHostAddress", host.startsWith('localhost') ? "http://localhost:8080" : `https://${host}`);
    });
    unityContext.on("GetWalletAddress", async () => {
      unityContext.send(gameManager, "SetWalletAddress", await getWalletAddress());
    });
    unityContext.on("BuyCardPack", async () => {
      //unityContext.send(gameManager, "OnBuyCardPack", await buyPack() ? 1 : 0); // TODO: Figure out why boolean parameters don't work
      unityContext.send(gameManager, "OnBuyCardPack", 1);
    });
    unityContext.on("RefundCardPack", async () => {
      unityContext.send(gameManager, "OnRefundCardPack", await refundPack() ? 1 : 0);
    });
    unityContext.on("OpenCardPack", openPack);
    browser.on('packOpened', (success: boolean) => {
      unityContext.send(gameManager, "OnOpenCardPack", success ? 1 : 0);
    });

  }, []);

  const mintSet = () => browser.emit('mintSet');
  const openPack = async () => browser.emit('openPack', await getWalletAddress());
  const switchAccount = async () => {
    await connectWallet();
    unityContext.send(gameManager, "SetWalletAddress", await getWalletAddress());
  };

  const cards = allCards();

  const loadingPct = () => Math.round(progression * 100);
  const Loading = () => (
    <Row>
      <Col>
        <ProgressBar now={loadingPct()} label={`Loading ${loadingPct()}%`} />
      </Col>
    </Row>
  );
  
  const SimpleButton = (props: any) => (
    <Col>
      <Button onClick={props.onClick}>
        {props.label}
      </Button>
    </Col>
  );

  const Progress = () => (
    <Row>
      <Col>
        <ProgressBar now={pct} label={label} />
      </Col>
    </Row>
  );

  const Error = () => (
    <Row>
      <Col>
        <p>{error}</p>
      </Col>
    </Row>
  );

  const OddsComponent = () => (
    <Row>
      <Col>
        <p>Odds:</p>
        {odds.map((value,_) => <ProgressBar now={value} label={value}
          min={850} max={1000} />)}
      </Col>
      <Col>
        <p>Totals: [{mintotals}..{maxtotals}]</p>
        {totals.map((value,i) => <ProgressBar now={value} label={`${cards[i]}(${value})`}
          min={mintotals-50} max={maxtotals} />)}
      </Col>
    </Row>
  );

  const MintButton = () => <SimpleButton label={"Mint default set"} onClick={mintSet} />;

  const DevPanel = () => (
    <Row xs="auto">
      <MintButton />
      <SimpleButton label={"Purchase pack"} onClick={buyPack} />
      <SimpleButton label={"Open pack"} onClick={openPack} />
      <SimpleButton label={"Refund pack"} onClick={refundPack} />
    </Row>
  );

  return (
    <div className="App">
      <header className="App-header">
        <Stack direction="horizontal">
          <Col md={3}><img src="/logo192.png" alt="da" height="64px" />
            digital arcana
          </Col>
          <Col></Col>
          <Col md={2}>
            <SimpleButton label={"Switch Account"} onClick={switchAccount} />
          </Col>
        </Stack>
        <Container fluid>
          <Unity
            unityContext={unityContext}
            style={{ width: "100%", height: "100%" }}
          />
          {progression < 1 && <Loading />}
          {pct > 0 && <Progress />}
          {isDevelopment && <DevPanel />}
          {error && <Error />}
          {odds.length > 0 && <OddsComponent />}
        </Container>
      </header>
    </div>
  );
}

export default App;
