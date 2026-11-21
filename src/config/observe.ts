import { createObserveModule } from '@nestjs/observe';

// One call shared by AppModule (ObserveModule) and main.ts (ObserveInstrument).
export const { ObserveModule, ObserveInstrument } = createObserveModule();
