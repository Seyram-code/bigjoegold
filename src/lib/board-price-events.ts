const BOARD_PRICES_UPDATED_EVENT = "bigjoegold:board-prices-updated";
const BOARD_PRICES_CHANNEL = "bigjoegold:board-prices";

export function notifyBoardPricesUpdated() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(BOARD_PRICES_UPDATED_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(BOARD_PRICES_CHANNEL);
    channel.postMessage("updated");
    channel.close();
  }
}

export function subscribeToBoardPriceUpdates(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  const onUpdate = () => callback();
  window.addEventListener(BOARD_PRICES_UPDATED_EVENT, onUpdate);

  const channel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(BOARD_PRICES_CHANNEL)
    : null;
  if (channel) channel.onmessage = onUpdate;

  return () => {
    window.removeEventListener(BOARD_PRICES_UPDATED_EVENT, onUpdate);
    channel?.close();
  };
}
