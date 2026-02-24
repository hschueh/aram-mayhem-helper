import data from "../aram-mayhem-data.json";
import AramHelper from "./components/AramHelper";

export default function Home() {
  return <AramHelper champions={data.champions as any} />;
}
