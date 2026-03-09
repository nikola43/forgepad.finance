import { io } from "socket.io-client";
import { API_ENDPOINT } from "@/config";

const socketOptions: any = {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 10000,
    transports: ['websocket', 'polling'],
};

export const socket = io(API_ENDPOINT, socketOptions);

// Log connection state for debugging
socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id)
})
socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason)
    if (reason === 'io server disconnect') {
        socket.connect()
    }
})
socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message)
})