import styles from "./page.module.css";
import dynamic from "next/dynamic";

const Assembler = dynamic(() => import("@/components/Assembler"), { ssr: false });

export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <Assembler />
    </main>
  );
}
