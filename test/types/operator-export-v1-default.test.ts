import { exportResults, type OperatorExport } from 'maps-reactive-crawler';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

const v1Export = exportResults({ checkpoint: 'compile-time-only' });
type NoOptionExportIsExactlyV1 = Assert<Equal<typeof v1Export, OperatorExport>>;
const v1TypeAssertion: NoOptionExportIsExactlyV1 = true;

void v1Export;
void v1TypeAssertion;

const v2Export = exportResults({ checkpoint: 'compile-time-only', format: 'v2' });
type V2VersionIsLiteral = Assert<Equal<typeof v2Export.version, 2>>;
const v2TypeAssertion: V2VersionIsLiteral = true;
void v2TypeAssertion;
