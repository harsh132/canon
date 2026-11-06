// Granting Pangolin the hardware wallet's USB port. Chrome only shows the port
// picker from a click in a visible page; once granted, the grant belongs to the
// extension's origin and the core reopens the port itself.
const ESPRESSIF_VID = 0x303a;
/** Dev builds: the JavaScript mock device (apps/hw-mock) stands in for USB. */
const MOCK_KEY = 'pangolin.hwMock';

type Serial = { requestPort: (o: { filters: { usbVendorId: number }[] }) => Promise<unknown>; getPorts: () => Promise<unknown[]> };

export const chooseDevice = async (): Promise<void> => {
  if (process.env.NODE_ENV !== 'production' && localStorage.getItem(MOCK_KEY)) return;
  const serial = (navigator as Navigator & { serial?: Serial }).serial;
  if (!serial) throw new Error('This browser has no USB serial (use Chrome)');
  try {
    await serial.requestPort({ filters: [{ usbVendorId: ESPRESSIF_VID }] });
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') throw new Error('No device chosen');
    throw e;
  }
};

/** Whether a port was granted before, so Unlock can skip the picker. */
export const hasDevice = async (): Promise<boolean> => {
  if (process.env.NODE_ENV !== 'production' && localStorage.getItem(MOCK_KEY)) return true;
  const serial = (navigator as Navigator & { serial?: Serial }).serial;
  return !!serial && (await serial.getPorts()).length > 0;
};
