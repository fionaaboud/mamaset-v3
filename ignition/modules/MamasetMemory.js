import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MamasetMemory", (m) => {
  const mamasetMemory = m.contract("MamasetMemory");
  return { mamasetMemory };
});
