// Granting Pangolin the hardware wallet, over Bluetooth or USB. Chrome only shows
// its device picker from a click in a visible page; once granted, the grant
// belongs to the extension's origin and the core reopens the device itself.
import { BLE, LINK_KEY, type HwLink } from '../shared/hwframe';

const ESPRESSIF_VID = 0x303a;
/** Dev builds: the JavaScript mock device (apps/hw-mock) stands in for the device. */
const MOCK_KEY = 'pangolin.hwMock';
const mocked = () => process.env.NODE_ENV !== 'production' && !!localStorage.getItem(MOCK_KEY);

type Serial = { requestPort: (o: { filters: { usbVendorId: number }[] }) => Promise<unknown>; getPorts: () => Promise<unknown[]> };
type Bluetooth = {
  requestDevice: (o: { filters: ({ services: string[] } | { name: string })[]; optionalServices: string[] }) => Promise<unknown>;
  getDevices?: () => Promise<unknown[]>;
};
const serial = () => (navigator as Navigator & { serial?: Serial }).serial;
const bluetooth = () => (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;

/** The link picked last; USB for wallets made before Bluetooth existed. */
export const hwLink = (): HwLink => (localStorage.getItem(LINK_KEY) === 'ble' ? 'ble' : 'usb');

export const chooseDevice = async (link: HwLink = hwLink()): Promise<void> => {
  try {
    if (!mocked()) await pick(link);
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') throw new Error('No device chosen');
    throw e;
  }
  // Also for the mock, so tests can exercise either link.
  localStorage.setItem(LINK_KEY, link);
};

const pick = async (link: HwLink): Promise<void> => {
  if (link === 'ble') {
    const bt = bluetooth();
    if (!bt) throw new Error('Bluetooth needs chrome://flags/#enable-web-bluetooth');
    await bt.requestDevice({ filters: [{ services: [BLE.service] }, { name: BLE.name }], optionalServices: [BLE.service] });
  } else {
    const s = serial();
    if (!s) throw new Error('This browser has no USB serial (use Chrome)');
    await s.requestPort({ filters: [{ usbVendorId: ESPRESSIF_VID }] });
  }
};

/** Whether a device was granted before on the current link, so Unlock can skip the picker. */
export const hasDevice = async (): Promise<boolean> => {
  if (mocked()) return true;
  if (hwLink() === 'ble') {
    const bt = bluetooth();
    return !!bt?.getDevices && (await bt.getDevices()).length > 0;
  }
  const s = serial();
  return !!s && (await s.getPorts()).length > 0;
};
