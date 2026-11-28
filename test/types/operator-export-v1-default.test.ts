import { exportResults, type OperatorExport } from 'maps-reactive-crawler';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

const v1Export = exportResults({ checkpoint: 'compile-time-only' });
type NoOptionExportIsExactlyV1 = Assert<Equal<typeof v1Export, OperatorExport>>;
const v1TypeAssertion: NoOptionExportIsExactlyV1 = true;

void v1Export;
void v1TypeAssertion;
