import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// src/App.tsx (React + Vite)
import { useCallback, useEffect, useRef, useState } from "react";
const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const CHAR_UUID = "12345678-1234-5678-1234-56789abcde01";
const DEVICE_STORAGE_KEY = "ble:lastDeviceId";
const DEVICE_NAME_PREFIX = "ESP32-SIREN";
export default function App() {
    const [status, setStatus] = useState("Disconnected");
    const [log, setLog] = useState([]);
    const charRef = useRef(null);
    const notifyHandlerRef = useRef(null);
    const deviceRef = useRef(null);
    const disconnectHandlerRef = useRef(null);
    const autoConnectAttemptedRef = useRef(false);
    const textDecoderRef = useRef(new TextDecoder());
    const append = useCallback((s) => {
        setLog(prev => [`${new Date().toLocaleTimeString()} ${s}`, ...prev].slice(0, 100));
    }, []);
    const handleValueChange = useCallback((event) => {
        const characteristic = event.target;
        const view = characteristic.value;
        if (!view)
            return;
        const txt = textDecoderRef.current.decode(view.buffer);
        append(`Notify: ${txt}`);
        try {
            const msg = JSON.parse(txt);
            if (msg.event === "siren_triggered")
                alert("🚨 Siren triggered!");
            if (msg.event === "siren_done")
                alert("✅ Siren done.");
        }
        catch {
            // ignore invalid JSON payloads
        }
    }, [append]);
    const setupNotifications = useCallback(async (characteristic) => {
        if (charRef.current && notifyHandlerRef.current) {
            charRef.current.removeEventListener("characteristicvaluechanged", notifyHandlerRef.current);
        }
        charRef.current = characteristic;
        notifyHandlerRef.current = handleValueChange;
        await characteristic.startNotifications();
        characteristic.addEventListener("characteristicvaluechanged", handleValueChange);
    }, [handleValueChange]);
    const registerDisconnectHandler = useCallback((device) => {
        if (deviceRef.current && disconnectHandlerRef.current) {
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
    const connectToDevice = useCallback(async (device) => {
        registerDisconnectHandler(device);
        try {
            setStatus("Connecting…");
            append(`Connecting to ${device.name || device.id}`);
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            const characteristic = await service.getCharacteristic(CHAR_UUID);
            await setupNotifications(characteristic);
            setStatus("Connected (notifications on)");
            append("Connected & listening for notifications");
        }
        catch (err) {
            console.error(err);
            setStatus("Error / Cancelled");
            append(`Error: ${err?.message || err}`);
            throw err;
        }
    }, [append, registerDisconnectHandler, setupNotifications]);
    const requestDeviceAndConnect = useCallback(async () => {
        if (!navigator.bluetooth) {
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
        await connectToDevice(device);
    }, [append, connectToDevice]);
    const connectBLE = useCallback(async () => {
        if (deviceRef.current) {
            try {
                append("Attempting to reconnect using saved device.");
                await connectToDevice(deviceRef.current);
                return;
            }
            catch {
                // fall back to request flow if reconnect fails
            }
        }
        try {
            await requestDeviceAndConnect();
        }
        catch (err) {
            // error already handled upstream
        }
    }, [append, connectToDevice, requestDeviceAndConnect]);
    useEffect(() => {
        if (autoConnectAttemptedRef.current)
            return;
        autoConnectAttemptedRef.current = true;
        if (!navigator.bluetooth) {
            setStatus("Web Bluetooth unavailable");
            append("Web Bluetooth API is not available in this browser.");
            return;
        }
        if (typeof navigator.bluetooth.getDevices !== "function") {
            append("Auto reconnect not supported in this browser (missing getDevices).");
            return;
        }
        const rememberedId = localStorage.getItem(DEVICE_STORAGE_KEY);
        if (!rememberedId) {
            append("No saved device id. Click Connect BLE first.");
            return;
        }
        setStatus("Checking saved devices…");
        append("Attempting automatic reconnect…");
        navigator.bluetooth.getDevices()
            .then(async (devices) => {
            const saved = devices.find(d => d.id === rememberedId);
            if (!saved) {
                append("Previously saved device not found. Need manual reconnection.");
                setStatus("Disconnected");
                return;
            }
            append(`Found saved device ${saved.name || saved.id}. Reconnecting…`);
            try {
                await connectToDevice(saved);
            }
            catch {
                // connectToDevice already logs status
            }
        })
            .catch(err => {
            console.error(err);
            append(`Auto reconnect failed: ${err?.message || err}`);
            setStatus("Auto reconnect failed");
        });
    }, [append, connectToDevice]);
    return (_jsxs("div", { style: { padding: 16, fontFamily: "system-ui" }, children: [_jsx("h1", { children: "ESP32 Siren Monitor (BLE)" }), _jsxs("p", { children: ["Status: ", _jsx("b", { children: status })] }), _jsx("button", { onClick: connectBLE, children: "Connect BLE" }), _jsxs("p", { children: ["Tips: klik Connect, pilih device bernama ", _jsx("code", { children: "ESP32-SIREN" }), "."] }), _jsx("h3", { children: "Log" }), _jsx("pre", { style: { background: "#111", color: "#0f0", padding: 12, borderRadius: 8, maxHeight: 320, overflow: "auto" }, children: log.join("\n") })] }));
}
