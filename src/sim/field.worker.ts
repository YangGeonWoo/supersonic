/** 음향장(1단계) 계산 Web Worker */
import { buildField, type FieldData, type FieldParams } from './scene';

export interface FieldRequest {
  id: number;
  fp: FieldParams;
}
export interface FieldResponse {
  id: number;
  fd: FieldData;
}

// DOM lib과 WebWorker lib을 같이 쓰면 타입이 충돌하므로 필요한 부분만 선언
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<FieldRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = (e: MessageEvent<FieldRequest>) => {
  const { id, fp } = e.data;
  const fd = buildField(fp);
  const res: FieldResponse = { id, fd };
  ctx.postMessage(res, [
    fd.field.pRe.buffer,
    fd.field.pIm.buffer,
    fd.field.p2.buffer,
    fd.field.g2.buffer,
    fd.axis.z.buffer,
    fd.axis.p2.buffer,
    fd.axis.g2.buffer,
  ]);
};
