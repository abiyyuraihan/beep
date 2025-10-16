// src/App.tsx (React + Vite)
import { useCallback, useEffect, useRef, useState } from "react";

const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const CHAR_UUID    = "12345678-1234-5678-1234-56789abcde01";
const DEVICE_STORAGE_KEY = "ble:lastDeviceId";
const DEVICE_NAME_PREFIX = "ESP32-SIREN";

export default function App(){
  const [status, setStatus] = useState("Disconnected");
  const [log, setLog] = useState<string[]>([]);
  const charRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const notifyHandlerRef = useRef<((event: Event) => void) | null>(null);
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const disconnectHandlerRef = useRef<((event: Event) => void) | null>(null);
  const autoConnectAttemptedRef = useRef(false);
  const textDecoderRef = useRef(new TextDecoder());

  const append = useCallback((s: string) => {
    setLog(prev => [`${new Date().toLocaleTimeString()} ${s}`, ...prev].slice(0, 100));
  }, []);

  const handleValueChange = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const view = characteristic.value;
    if (!view) return;
    const txt = textDecoderRef.current.decode(view.buffer);
    append(`Notify: ${txt}`);

    try{
      const msg = JSON.parse(txt);
      if (msg.event === "siren_triggered") alert("🚨 Siren triggered!");
      if (msg.event === "siren_done") alert("✅ Siren done.");
    }catch{
      // ignore invalid JSON payloads
    }
  }, [append]);

  const setupNotifications = useCallback(async (characteristic: BluetoothRemoteGATTCharacteristic) => {
    if (charRef.current && notifyHandlerRef.current){
      charRef.current.removeEventListener("characteristicvaluechanged", notifyHandlerRef.current);
    }

    charRef.current = characteristic;
    notifyHandlerRef.current = handleValueChange;

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleValueChange);
  }, [handleValueChange]);

  const registerDisconnectHandler = useCallback((device: BluetoothDevice) => {
    if (deviceRef.current && disconnectHandlerRef.current){
      deviceRef.current.removeEventListener("gattserverdisconnected", disconnectHandlerRef.current);
    }

    const onDisconnect = () => {
      setStatus("Disconnected");
      append("Device disconnected");
      charRef.current = null;
    };

    device.addEventListener("gattserverdisconnected", onDisconnect);
    deviceRef.current = device;
    disconnectHandlerRef.current = onDisconnect;
  }, [append]);

  type ConnectOptions = { suppressErrorStatus?: boolean };

  const connectToDevice = useCallback(async (
    device: BluetoothDevice,
    options: ConnectOptions = {},
  ) => {
    registerDisconnectHandler(device);

    try{
      setStatus("Connecting…");
      append(`Connecting to ${device.name || device.id}`);
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(CHAR_UUID);

      await setupNotifications(characteristic);

      setStatus("Connected (notifications on)");
      append("Connected & listening for notifications");
      return { ok: true as const };
    }catch(err: any){
      console.error(err);
      charRef.current = null;
      if (!options.suppressErrorStatus){
        setStatus("Error / Cancelled");
      }
      append(`Error: ${err?.message || err}`);
      return { ok: false as const, error: err };
    }
  }, [append, registerDisconnectHandler, setupNotifications]);

  const requestDeviceAndConnect = useCallback(async () => {
    if (!navigator.bluetooth){
      setStatus("Web Bluetooth unavailable");
      append("Web Bluetooth API is not available in this browser.");
      return;
    }

    setStatus("Requesting device…");

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [SERVICE_UUID],
    });

    localStorage.setItem(DEVICE_STORAGE_KEY, device.id);
    append(`Saved device id ${device.id} for auto reconnect`);

    return connectToDevice(device);
  }, [append, connectToDevice]);

  const connectBLE = useCallback(async () => {
    if (deviceRef.current){
      append("Attempting to reconnect using saved device in memory.");
      const result = await connectToDevice(deviceRef.current);
      if (result.ok) return;
    }

    const rememberedId = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (rememberedId && navigator.bluetooth && typeof navigator.bluetooth.getDevices === "function"){
      append("Checking saved devices list for quick reconnect.");
      try{
        const devices = await navigator.bluetooth.getDevices();
        const saved = devices.find(d => d.id === rememberedId);
        if (saved){
          deviceRef.current = saved;
          const result = await connectToDevice(saved);
          if (result.ok) return;
        }else{
          append("Saved device not found in getDevices result. Need manual selection.");
        }
      }catch(err: any){
        console.error(err);
        append(`Quick reconnect failed: ${err?.message || err}`);
      }
    }

    try{
      const result = await requestDeviceAndConnect();
      if (!result?.ok){
        // error already handled upstream
      }
    }catch{
      // error already handled upstream
    }
  }, [append, connectToDevice, requestDeviceAndConnect]);

  useEffect(() => {
    if (autoConnectAttemptedRef.current) return;
    autoConnectAttemptedRef.current = true;

    if (!navigator.bluetooth){
      setStatus("Web Bluetooth unavailable");
      append("Web Bluetooth API is not available in this browser.");
      return;
    }

    if (typeof navigator.bluetooth.getDevices !== "function"){
      append("Auto reconnect not supported in this browser (missing getDevices).");
      return;
    }

    const rememberedId = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!rememberedId){
      append("No saved device id. Click Connect BLE first.");
      return;
    }

    setStatus("Checking saved devices…");
    append("Attempting automatic reconnect…");

    navigator.bluetooth.getDevices()
      .then(async devices => {
        const saved = devices.find(d => d.id === rememberedId);
        if (!saved){
          append("Previously saved device not found. Need manual reconnection.");
          setStatus("Disconnected");
          return;
        }

        append(`Found saved device ${saved.name || saved.id}. Reconnecting…`);

        const result = await connectToDevice(saved, { suppressErrorStatus: true });
        if (!result.ok){
          const message = result.error?.message || String(result.error || "");
          const requiresGesture =
            result.error?.name === "SecurityError" ||
            /gesture|activation/i.test(message);

          if (requiresGesture){
            append("Browser requires a user gesture to reconnect. Click Connect BLE.");
            setStatus("Waiting for user action");
            deviceRef.current = saved;
          }else{
            append("Auto reconnect failed. Please reconnect manually.");
            setStatus("Auto reconnect failed");
          }
        }
      })
      .catch(err => {
        console.error(err);
        append(`Auto reconnect failed: ${err?.message || err}`);
        setStatus("Auto reconnect failed");
      });
  }, [append, connectToDevice]);

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
