// src/App.tsx (React + Vite)
import { useEffect, useRef, useState } from "react";

const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const CHAR_UUID    = "12345678-1234-5678-1234-56789abcde01";

export default function App(){
  const [status, setStatus] = useState("Disconnected");
  const [log, setLog] = useState<string[]>([]);
  const charRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  const append = (s: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString()} ${s}`, ...prev].slice(0, 100));

  async function connectBLE(){
    try{
      setStatus("Requesting device…");
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          // bisa berdasarkan nama prefix:
          { namePrefix: "ESP32-SIREN" },
        ],
        optionalServices: [SERVICE_UUID],
      });

      device.addEventListener("gattserverdisconnected", () => {
        setStatus("Disconnected");
        append("Device disconnected");
      });

      setStatus("Connecting…");
      const server = await device.gatt!.connect();

      const service = await server.getPrimaryService(SERVICE_UUID);
      const ch = await service.getCharacteristic(CHAR_UUID);
      charRef.current = ch;

      await ch.startNotifications();
      ch.addEventListener("characteristicvaluechanged", (e: Event) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value!;
        const txt = new TextDecoder().decode(v.buffer);
        append(`Notify: ${txt}`);
        try{
          const msg = JSON.parse(txt);
          if (msg.event === "siren_triggered") alert("🚨 Siren triggered!");
          if (msg.event === "siren_done") alert("✅ Siren done.");
        }catch{}
      });

      setStatus("Connected (notifications on)");
      append("Connected & listening for notifications");
    }catch(err:any){
      console.error(err);
      setStatus("Error / Cancelled");
      append(`Error: ${err?.message || err}`);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <h1>ESP32 Siren Monitor (BLE)</h1>
      <p>Status: <b>{status}</b></p>
      <button onClick={connectBLE}>Connect BLE</button>
      <p>Tips: klik Connect, pilih device bernama <code>ESP32-SIREN</code>.</p>
      <h3>Log</h3>
      <pre style={{background:"#111",color:"#0f0",padding:12,borderRadius:8,maxHeight:320,overflow:"auto"}}>
        {log.join("\n")}
      </pre>
    </div>
  );
}
