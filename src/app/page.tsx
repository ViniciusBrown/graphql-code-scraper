import Image from "next/image";
import MainPage from "./components/MainPage";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <MainPage />
      
    </main>
  );
}
