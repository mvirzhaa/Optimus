/* ===== Optimus core: demand, vehicle models, simulation, emissions, detectors ===== */

SW.VCLASS = {
  passenger: { length: 5, minGap: 2.5, accel: 2.6, decel: 4.5, emergencyDecel: 9, sigma: 0.5, tau: 1, maxSpeed: 55.56, mass: 1500, emissionClass: 'PC_G_EU4', color: '#f2c94c', width: 1.8, cda: 0.7 },
  evehicle: { length: 4.5, minGap: 2.5, accel: 2.8, decel: 4.5, emergencyDecel: 9, sigma: 0.5, tau: 1, maxSpeed: 44.4, mass: 1830, emissionClass: 'Energy', color: '#27ae60', width: 1.8, cda: 0.6, batteryCapacity: 35000 },
  bus: { length: 12, minGap: 2.5, accel: 1.2, decel: 4, emergencyDecel: 7, sigma: 0.5, tau: 1, maxSpeed: 27.78, mass: 12000, emissionClass: 'HDV_D_EU4', color: '#2d9cdb', width: 2.5, cda: 6 },
  truck: { length: 7.1, minGap: 2.5, accel: 1.3, decel: 4, emergencyDecel: 7, sigma: 0.5, tau: 1, maxSpeed: 36.1, mass: 10000, emissionClass: 'HDV_D_EU4', color: '#9b51e0', width: 2.4, cda: 5 },
  motorcycle: { length: 2.0, minGap: 1.0, accel: 4.5, decel: 7, emergencyDecel: 9, sigma: 0.5, tau: 1, maxSpeed: 27.78, mass: 200, emissionClass: 'MC_4S_EU3', color: '#eb5757', width: 0.9, cda: 0.5 },
  bicycle: { length: 1.6, minGap: 0.5, accel: 1.2, decel: 3, emergencyDecel: 7, sigma: 0.5, tau: 1, maxSpeed: 5.56, mass: 90, emissionClass: 'zero', color: '#56ccf2', width: 0.65, cda: 0.5 },
  angkot: { length: 4.2, minGap: 2, accel: 2.2, decel: 4.5, emergencyDecel: 8, sigma: 0.6, tau: 1, maxSpeed: 16.67, mass: 1300, emissionClass: 'PC_G_EU4', color: '#1e9e5a', width: 1.6, cda: 0.8, ngetem: { perKm: 3, min: 8, max: 45 } },
  emergency: { length: 6.5, minGap: 2.5, accel: 2.6, decel: 4.5, emergencyDecel: 9, sigma: 0.2, tau: 1, maxSpeed: 44.4, mass: 2600, emissionClass: 'PC_D_EU4', color: '#ffffff', width: 2.1, cda: 0.9, speedFactor: 1.5 }
};
SW.EMISSION_CLASSES = ['PC_G_EU4', 'PC_D_EU4', 'LDV_G_EU4', 'HDV_D_EU4', 'MC_4S_EU3', 'Energy', 'zero'];
SW.EMISSION_SUMO = { PC_G_EU4: 'HBEFA3/PC_G_EU4', PC_D_EU4: 'HBEFA3/PC_D_EU4', LDV_G_EU4: 'HBEFA3/LDV_G_EU4', HDV_D_EU4: 'HBEFA3/HDV_D_EU4', MC_4S_EU3: 'HBEFA4/MC_4S_le250cc_Euro-3', Energy: 'Energy/unknown', zero: 'Zero' };
SW.makeVType = function (id, vClass, o = {}) {
  const base = SW.VCLASS[vClass] || SW.VCLASS.passenger;
  return Object.assign({ id, vClass: vClass || 'passenger', carFollowModel: 'Krauss', speedFactor: 1, speedDev: 0.1, lcSpeedGain: 1, lcKeepRight: 1, lcStrategic: 1, lcCooperative: 1, lcDuration: 1.5 }, base, o, { id, vClass: o.vClass || vClass || 'passenger' });
};
SW.newDemand = function () {
  return { vTypes: { DEFAULT_VEHTYPE: SW.makeVType('DEFAULT_VEHTYPE', 'passenger') }, routes: {}, vehicles: [], flows: [] };
};
SW.newAdditional = function () { return { e1: [], e2: [], busStops: [], crossings: [] }; };
SW.defaultConfig = function () { return { begin: 0, end: 3600, stepLength: 0.5, seed: 42, timeToTeleport: 300, period: 60, delay: 50, sublane: true, warmup: 0 }; };

/* ---------- emission / energy models, calibrated against Eclipse SUMO 1.28 ----------
   HBEFA3 classes: SUMO's polynomial form, coefficients fitted to emissionsDrivingCycle output
   (E[mg/s] = max(0, c0 + c1*a*v + c2*a^2*v + c3*v + c4*v^2 + c5*v^3), v in km/h).
   Motorcycles (HBEFA4 MC 4-stroke <=250cc Euro-3): bilinear lookup table from SUMO.
   Electric: linear fit to SUMO's Energy model, scaled by mass and drag area. */
SW.EMI_HBEFA = {"PC_G_EU4":{"CO":[164.778,1.49074,-6.71871e-09,-5.65201,0.0447103,-2.37261e-10],"CO2":[2624.72,72.4074,-1.62594e-05,-36.0416,0.605709,4.42693e-09],"HC":[0.811944,0.00858796,1.11794e-09,-0.026821,0.000221193,1.86268e-12],"PMx":[0.0659722,0.00189043,2.40077e-10,-0.00250849,2.83993e-05,2.24055e-13],"NOx":[1.20444,0.0341667,1.12081e-08,-0.0247221,0.000293851,1.25584e-11],"fuel":[837.222,23.0941,9.99764e-06,-11.4969,0.193201,4.51335e-09]},"PC_D_EU4":{"CO":[0.584722,0.00223611,-9.73377e-10,-0.00277237,-1.18452e-10,4.69486e-13],"CO2":[1895.56,57.2762,4.03387e-06,-15.0698,0.3528,-2.38891e-08],"HC":[0.0335556,0.00127238,-2.13186e-10,0.0017446,3.67217e-11,-1.58391e-13],"PMx":[0.0,0.0,0.0,0.0,0.0,0.0],"NOx":[13.1806,0.309491,2.3185e-08,-0.313349,0.00347007,7.5993e-11],"fuel":[596.389,18.017,-1.04433e-06,-4.74152,0.110983,-1.34527e-10]},"LDV_G_EU4":{"CO":[157.611,3.35108,1.15268e-07,-5.91744,0.0561128,9.29186e-11],"CO2":[1404.44,78.3179,-9.40498e-06,22.1065,6.23304e-07,0.00188853],"HC":[0.57,0.0147454,1.36155e-10,-0.020463,0.000211934,5.92788e-13],"PMx":[0.163667,0.00467515,-5.51647e-11,-0.00583566,6.40005e-05,-6.91984e-13],"NOx":[0.305556,0.0145988,-1.39857e-09,0.00679704,5.56449e-10,-2.67981e-12],"fuel":[448.056,24.9846,-9.02645e-06,7.05168,1.31902e-07,0.000602519]},"HDV_D_EU4":{"CO":[14.0778,0.513502,2.69188e-07,0.0644214,1.69204e-09,-1.99391e-11],"CO2":[6747.22,554.012,9.15181e-06,141.589,3.48933e-06,-1.52197e-08],"HC":[0.310833,0.0134799,5.81316e-10,0.00248227,-2.21219e-10,8.35824e-13],"PMx":[0.351944,0.010108,-2.28028e-09,-0.000494191,-3.18907e-10,1.13567e-12],"NOx":[56.1667,3.26698,-1.42965e-07,0.683486,1.24824e-08,-1.57557e-11],"fuel":[2121.94,174.306,-2.98737e-07,44.5296,-5.32358e-06,2.87569e-08]}};
SW.EMI_TABLE = { MC_4S_EU3: { v0: 0, dv: 1, a0: -3, da: 0.5, nv: 41, na: 13, data: {"CO":[[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.318,0.6359,0.9538,1.272,1.59,1.908],[0.0,0.0,0.0,0.0,0.0,0.0,0.003773,0.3357,0.6675,0.9994,1.331,1.663,1.995],[0.0,0.0,0.0,0.0,0.0,0.0,0.03018,0.4039,0.7776,1.151,1.525,1.899,2.272],[0.0,0.0,0.0,0.0,0.0,0.0,0.1019,0.5452,0.9886,1.432,1.875,2.319,2.762],[0.0,0.0,0.0,0.0,0.0,0.0,0.2415,0.7824,1.323,1.864,2.405,2.946,3.487],[0.0,0.0,0.0,0.0,0.0,0.0,0.4716,1.138,1.804,2.471,3.137,3.803,4.47],[0.0,0.0,0.0,0.0,0.0,0.0,0.815,1.635,2.454,3.274,4.093,4.913,5.733],[0.0,0.0,0.0,0.0,0.0,0.0,1.294,2.295,3.296,4.296,5.297,6.298,7.299],[0.0,0.0,0.0,0.0,0.0,0.0,1.932,3.142,4.351,5.561,6.771,7.981,9.191],[0.0,0.0,0.0,0.0,0.0,0.0,2.751,4.197,5.644,7.091,8.537,9.984,11.43],[0.0,0.0,0.0,0.0,0.0,0.0,3.773,5.484,7.196,8.907,10.62,12.33,14.04],[0.0,0.0,0.0,0.0,0.0,0.0,5.022,7.026,9.03,11.03,13.04,15.04,17.05],[0.0,0.0,0.0,0.0,0.0,0.0,6.52,8.844,11.17,13.49,15.82,18.14,20.47],[0.0,0.0,0.0,0.0,0.0,0.0,8.289,10.96,13.64,16.31,18.98,21.65,24.33],[0.0,0.0,0.0,0.0,0.0,0.0,10.35,13.4,16.45,19.5,22.55,25.6,28.65],[0.0,0.0,0.0,0.0,0.0,0.0,12.73,16.19,19.64,23.09,26.55,30.0,33.45],[0.0,0.0,0.0,0.0,0.0,0.0,15.45,19.34,23.22,27.11,31.0,34.88,38.77],[0.0,0.0,0.0,0.0,0.0,0.0,18.54,22.88,27.23,31.57,35.92,40.26,44.61],[0.0,0.0,0.0,0.0,0.0,0.0,22.0,26.84,31.67,36.5,41.34,46.17,51.0],[0.0,0.0,0.0,0.0,0.0,0.0,25.88,31.23,36.58,41.92,47.27,52.62,57.97],[0.0,0.0,0.0,0.0,0.0,0.0,30.18,36.08,41.97,47.86,53.75,59.64,65.54],[0.0,0.0,0.0,0.0,0.0,0.0,34.94,41.41,47.87,54.33,60.79,67.26,73.72],[0.0,0.0,0.0,0.0,0.0,0.0,40.17,47.24,54.3,61.36,68.42,75.49,82.55],[0.0,0.0,0.0,0.0,0.0,0.0,45.91,53.6,61.29,68.97,76.66,84.35,92.04],[0.0,0.0,0.0,0.0,0.0,0.0,52.16,60.5,68.85,77.19,85.54,93.88,102.2],[0.0,0.0,0.0,0.0,0.0,0.0,58.95,67.98,77.01,86.04,95.06,104.1,113.1],[0.0,0.0,0.0,0.0,0.0,0.0,66.31,76.05,85.79,95.53,105.3,115.0,124.7],[0.0,0.0,0.0,0.0,0.0,0.0,74.26,84.74,95.22,105.7,116.2,126.6,137.1],[0.0,0.0,0.0,0.0,0.0,0.0,82.82,94.07,105.3,116.6,127.8,139.0,150.3],[0.0,0.0,0.0,0.0,0.0,0.0,92.02,104.1,116.1,128.1,140.2,152.2,164.2],[0.0,0.0,0.0,0.0,0.0,0.0,101.9,114.7,127.6,140.4,153.3,166.2,179.0],[0.0,0.0,0.0,0.0,0.0,98.69,112.4,126.1,139.8,153.5,167.2,180.9,194.7],[0.0,0.0,0.0,0.0,0.0,109.0,123.6,138.2,152.8,167.4,182.0,196.6,211.2],[0.0,0.0,0.0,0.0,0.0,120.1,135.6,151.1,166.6,182.1,197.6,213.1,228.5],[0.0,0.0,0.0,0.0,0.0,131.9,148.3,164.7,181.1,197.6,214.0,230.4,246.9],[0.0,0.0,0.0,0.0,0.0,144.4,161.8,179.2,196.5,213.9,231.3,248.7,266.1],[0.0,0.0,0.0,0.0,0.0,157.7,176.0,194.4,212.8,231.2,249.5,267.9,286.3],[0.0,0.0,0.0,0.0,0.0,171.7,191.1,210.5,229.9,249.3,268.7,288.1,307.5],[0.0,0.0,0.0,0.0,0.0,186.6,207.0,227.5,247.9,268.4,288.8,309.2,329.7],[0.0,0.0,0.0,0.0,0.0,202.3,223.8,245.3,266.8,288.4,309.9,331.4,352.9],[0.0,0.0,0.0,0.0,0.0,218.9,241.5,264.1,286.7,309.3,331.9,354.5,377.2]],"CO2":[[229.0,229.0,229.0,229.0,229.0,229.0,229.0,229.0,229.0,229.0,229.0,229.0,229.0],[0.0,0.0,0.0,0.0,0.0,0.0,236.8,249.9,263.1,276.2,289.3,302.4,315.5],[0.0,0.0,0.0,0.0,0.0,0.0,246.1,272.8,299.5,326.2,352.9,379.7,406.4],[0.0,0.0,0.0,0.0,0.0,0.0,257.1,297.9,338.7,379.5,420.3,461.1,501.9],[0.0,0.0,0.0,0.0,0.0,0.0,270.0,325.4,380.8,436.1,491.5,546.9,602.3],[0.0,0.0,0.0,0.0,0.0,0.0,285.2,355.6,426.1,496.5,566.9,637.4,707.8],[0.0,0.0,0.0,0.0,0.0,0.0,302.9,388.9,474.9,560.9,646.8,732.8,818.8],[0.0,0.0,0.0,0.0,0.0,0.0,323.3,425.4,527.4,629.4,731.5,833.5,935.5],[0.0,0.0,0.0,0.0,0.0,0.0,346.9,465.4,584.0,702.6,821.1,939.7,1058.0],[0.0,0.0,0.0,0.0,0.0,0.0,373.7,509.3,644.9,780.5,916.0,1052.0,1187.0],[0.0,0.0,0.0,0.0,0.0,0.0,404.2,557.3,710.3,863.4,1016.0,1170.0,1323.0],[0.0,0.0,0.0,0.0,0.0,0.0,438.5,609.6,780.6,951.7,1123.0,1294.0,1465.0],[0.0,0.0,0.0,0.0,0.0,0.0,476.9,666.5,856.0,1046.0,1235.0,1425.0,1614.0],[0.0,0.0,0.0,0.0,0.0,0.0,519.8,728.3,936.8,1145.0,1354.0,1562.0,1771.0],[0.0,0.0,0.0,0.0,0.0,0.0,567.3,795.2,1023.0,1251.0,1479.0,1707.0,1935.0],[0.0,0.0,0.0,0.0,0.0,0.0,619.7,867.6,1116.0,1363.0,1611.0,1859.0,2107.0],[0.0,0.0,0.0,0.0,0.0,0.0,677.4,945.7,1214.0,1482.0,1751.0,2019.0,2287.0],[0.0,0.0,0.0,0.0,0.0,0.0,740.6,1030.0,1319.0,1608.0,1898.0,2187.0,2476.0],[0.0,0.0,0.0,0.0,0.0,0.0,809.5,1120.0,1431.0,1741.0,2052.0,2363.0,2673.0],[0.0,0.0,0.0,0.0,0.0,0.0,884.4,1217.0,1549.0,1882.0,2214.0,2547.0,2880.0],[0.0,0.0,0.0,0.0,0.0,0.0,965.6,1320.0,1675.0,2030.0,2385.0,2740.0,3095.0],[0.0,0.0,0.0,0.0,0.0,0.0,1053.0,1431.0,1809.0,2187.0,2564.0,2942.0,3320.0],[0.0,0.0,0.0,0.0,0.0,0.0,1148.0,1549.0,1950.0,2351.0,2752.0,3154.0,3555.0],[0.0,0.0,0.0,0.0,0.0,0.0,1250.0,1675.0,2100.0,2525.0,2950.0,3374.0,3799.0],[0.0,0.0,0.0,0.0,0.0,0.0,1359.0,1808.0,2257.0,2707.0,3156.0,3605.0,4054.0],[0.0,0.0,0.0,0.0,0.0,0.0,1475.0,1950.0,2424.0,2898.0,3372.0,3846.0,4320.0],[0.0,0.0,0.0,0.0,0.0,0.0,1600.0,2099.0,2599.0,3098.0,3598.0,4097.0,4596.0],[0.0,0.0,0.0,0.0,0.0,0.0,1733.0,2258.0,2783.0,3308.0,3834.0,4359.0,4884.0],[0.0,0.0,0.0,0.0,0.0,0.0,1874.0,2426.0,2977.0,3529.0,4080.0,4631.0,5183.0],[0.0,0.0,0.0,0.0,0.0,0.0,2024.0,2602.0,3181.0,3759.0,4337.0,4915.0,5493.0],[0.0,0.0,0.0,0.0,0.0,0.0,2183.0,2789.0,3394.0,4000.0,4605.0,5210.0,5816.0],[0.0,0.0,0.0,0.0,0.0,1718.0,2351.0,2985.0,3618.0,4251.0,4884.0,5517.0,6151.0],[0.0,0.0,0.0,0.0,0.0,1868.0,2529.0,3190.0,3852.0,4513.0,5175.0,5836.0,6498.0],[0.0,0.0,0.0,0.0,0.0,2026.0,2717.0,3407.0,4097.0,4787.0,5477.0,6167.0,6858.0],[0.0,0.0,0.0,0.0,0.0,2195.0,2914.0,3634.0,4353.0,5072.0,5792.0,6511.0,7230.0],[0.0,0.0,0.0,0.0,0.0,2373.0,3122.0,3871.0,4620.0,5369.0,6118.0,6867.0,7616.0],[0.0,0.0,0.0,0.0,0.0,2562.0,3341.0,4120.0,4899.0,5678.0,6458.0,7237.0,8016.0],[0.0,0.0,0.0,0.0,0.0,2760.0,3570.0,4380.0,5190.0,6000.0,6810.0,7620.0,8429.0],[0.0,0.0,0.0,0.0,0.0,2970.0,3811.0,4652.0,5493.0,6334.0,7175.0,8016.0,8857.0],[0.0,0.0,0.0,0.0,0.0,3190.0,4063.0,4935.0,5808.0,6681.0,7553.0,8426.0,9299.0],[0.0,0.0,0.0,0.0,0.0,3422.0,4326.0,5231.0,6136.0,7041.0,7946.0,8850.0,9755.0]],"HC":[[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.1515,0.3029,0.4543,0.6058,0.7572,0.9087],[0.0,0.0,0.0,0.0,0.0,0.0,0.002736,0.1544,0.3061,0.4577,0.6094,0.761,0.9127],[0.0,0.0,0.0,0.0,0.0,0.0,0.01116,0.1635,0.3158,0.4681,0.6204,0.7727,0.925],[0.0,0.0,0.0,0.0,0.0,0.0,0.02559,0.1789,0.3323,0.4857,0.639,0.7924,0.9458],[0.0,0.0,0.0,0.0,0.0,0.0,0.04635,0.2012,0.356,0.5109,0.6657,0.8206,0.9755],[0.0,0.0,0.0,0.0,0.0,0.0,0.07376,0.2305,0.3873,0.5441,0.7008,0.8576,1.014],[0.0,0.0,0.0,0.0,0.0,0.0,0.1081,0.2672,0.4263,0.5855,0.7446,0.9037,1.063],[0.0,0.0,0.0,0.0,0.0,0.0,0.1498,0.3117,0.4736,0.6354,0.7973,0.9592,1.121],[0.0,0.0,0.0,0.0,0.0,0.0,0.1991,0.3642,0.5292,0.6943,0.8593,1.024,1.189],[0.0,0.0,0.0,0.0,0.0,0.0,0.2564,0.425,0.5937,0.7624,0.931,1.1,1.268],[0.0,0.0,0.0,0.0,0.0,0.0,0.3219,0.4946,0.6673,0.84,1.013,1.185,1.358],[0.0,0.0,0.0,0.0,0.0,0.0,0.396,0.5731,0.7503,0.9275,1.105,1.282,1.459],[0.0,0.0,0.0,0.0,0.0,0.0,0.4789,0.661,0.8431,1.025,1.207,1.389,1.571],[0.0,0.0,0.0,0.0,0.0,0.0,0.5712,0.7585,0.9459,1.133,1.321,1.508,1.695],[0.0,0.0,0.0,0.0,0.0,0.0,0.6729,0.8661,1.059,1.252,1.445,1.638,1.832],[0.0,0.0,0.0,0.0,0.0,0.0,0.7846,0.9839,1.183,1.382,1.582,1.781,1.98],[0.0,0.0,0.0,0.0,0.0,0.0,0.9064,1.112,1.318,1.524,1.73,1.936,2.142],[0.0,0.0,0.0,0.0,0.0,0.0,1.039,1.252,1.465,1.677,1.89,2.103,2.316],[0.0,0.0,0.0,0.0,0.0,0.0,1.182,1.402,1.623,1.843,2.063,2.284,2.504],[0.0,0.0,0.0,0.0,0.0,0.0,1.336,1.565,1.793,2.021,2.249,2.477,2.705],[0.0,0.0,0.0,0.0,0.0,0.0,1.502,1.739,1.975,2.212,2.448,2.685,2.921],[0.0,0.0,0.0,0.0,0.0,0.0,1.68,1.925,2.17,2.415,2.661,2.906,3.151],[0.0,0.0,0.0,0.0,0.0,0.0,1.87,2.124,2.378,2.633,2.887,3.141,3.396],[0.0,0.0,0.0,0.0,0.0,0.0,2.072,2.336,2.6,2.863,3.127,3.391,3.655],[0.0,0.0,0.0,0.0,0.0,0.0,2.287,2.561,2.835,3.108,3.382,3.656,3.93],[0.0,0.0,0.0,0.0,0.0,0.0,2.515,2.799,3.083,3.368,3.652,3.936,4.221],[0.0,0.0,0.0,0.0,0.0,0.0,2.756,3.051,3.347,3.642,3.937,4.232,4.527],[0.0,0.0,0.0,0.0,0.0,0.0,3.012,3.318,3.624,3.931,4.237,4.544,4.85],[0.0,0.0,0.0,0.0,0.0,0.0,3.281,3.599,3.917,4.235,4.553,4.871,5.189],[0.0,0.0,0.0,0.0,0.0,0.0,3.565,3.895,4.225,4.555,4.885,5.216,5.546],[0.0,0.0,0.0,0.0,0.0,0.0,3.863,4.206,4.548,4.891,5.234,5.577,5.919],[0.0,0.0,0.0,0.0,0.0,3.821,4.176,4.532,4.888,5.243,5.599,5.955,6.311],[0.0,0.0,0.0,0.0,0.0,4.136,4.505,4.874,5.243,5.612,5.981,6.351,6.72],[0.0,0.0,0.0,0.0,0.0,4.467,4.849,5.232,5.615,5.998,6.381,6.764,7.147],[0.0,0.0,0.0,0.0,0.0,4.813,5.21,5.607,6.004,6.401,6.798,7.196,7.593],[0.0,0.0,0.0,0.0,0.0,5.175,5.587,5.998,6.41,6.822,7.234,7.646,8.057],[0.0,0.0,0.0,0.0,0.0,5.553,5.98,6.407,6.834,7.261,7.688,8.114,8.541],[0.0,0.0,0.0,0.0,0.0,5.948,6.39,6.833,7.275,7.718,8.16,8.602,9.045],[0.0,0.0,0.0,0.0,0.0,6.359,6.818,7.276,7.735,8.193,8.651,9.11,9.568],[0.0,0.0,0.0,0.0,0.0,6.788,7.263,7.738,8.212,8.687,9.162,9.637,10.11],[0.0,0.0,0.0,0.0,0.0,7.235,7.726,8.218,8.709,9.201,9.692,10.18,10.68]],"PMx":[[0.1356,0.1356,0.1356,0.1356,0.1356,0.1356,0.1356,0.1356,0.1356,0.1356,0.1356,0.1356,0.1356],[0.0,0.0,0.0,0.0,0.0,0.0,0.137,0.1378,0.1385,0.1393,0.14,0.1407,0.1415],[0.0,0.0,0.0,0.0,0.0,0.0,0.1385,0.14,0.1416,0.1431,0.1446,0.1461,0.1476],[0.0,0.0,0.0,0.0,0.0,0.0,0.1401,0.1425,0.1448,0.1471,0.1494,0.1517,0.1541],[0.0,0.0,0.0,0.0,0.0,0.0,0.1419,0.1451,0.1483,0.1514,0.1546,0.1578,0.1609],[0.0,0.0,0.0,0.0,0.0,0.0,0.144,0.148,0.1521,0.1561,0.1601,0.1642,0.1682],[0.0,0.0,0.0,0.0,0.0,0.0,0.1464,0.1513,0.1563,0.1612,0.1661,0.1711,0.176],[0.0,0.0,0.0,0.0,0.0,0.0,0.1492,0.155,0.1609,0.1668,0.1726,0.1785,0.1844],[0.0,0.0,0.0,0.0,0.0,0.0,0.1524,0.1592,0.166,0.1729,0.1797,0.1866,0.1934],[0.0,0.0,0.0,0.0,0.0,0.0,0.1561,0.1639,0.1718,0.1796,0.1874,0.1953,0.2031],[0.0,0.0,0.0,0.0,0.0,0.0,0.1604,0.1692,0.1781,0.187,0.1959,0.2047,0.2136],[0.0,0.0,0.0,0.0,0.0,0.0,0.1653,0.1752,0.1852,0.1951,0.2051,0.215,0.2249],[0.0,0.0,0.0,0.0,0.0,0.0,0.1709,0.1819,0.193,0.204,0.2151,0.2261,0.2371],[0.0,0.0,0.0,0.0,0.0,0.0,0.1773,0.1895,0.2016,0.2138,0.226,0.2381,0.2503],[0.0,0.0,0.0,0.0,0.0,0.0,0.1845,0.1978,0.2112,0.2245,0.2378,0.2512,0.2645],[0.0,0.0,0.0,0.0,0.0,0.0,0.1926,0.2071,0.2217,0.2362,0.2507,0.2652,0.2798],[0.0,0.0,0.0,0.0,0.0,0.0,0.2016,0.2174,0.2332,0.2489,0.2647,0.2804,0.2962],[0.0,0.0,0.0,0.0,0.0,0.0,0.2117,0.2287,0.2458,0.2628,0.2798,0.2968,0.3138],[0.0,0.0,0.0,0.0,0.0,0.0,0.2229,0.2412,0.2595,0.2778,0.2961,0.3144,0.3327],[0.0,0.0,0.0,0.0,0.0,0.0,0.2352,0.2548,0.2744,0.2941,0.3137,0.3333,0.353],[0.0,0.0,0.0,0.0,0.0,0.0,0.2487,0.2697,0.2906,0.3116,0.3326,0.3536,0.3746],[0.0,0.0,0.0,0.0,0.0,0.0,0.2634,0.2858,0.3082,0.3306,0.353,0.3754,0.3977],[0.0,0.0,0.0,0.0,0.0,0.0,0.2795,0.3033,0.3271,0.351,0.3748,0.3986,0.4224],[0.0,0.0,0.0,0.0,0.0,0.0,0.297,0.3223,0.3476,0.3728,0.3981,0.4233,0.4486],[0.0,0.0,0.0,0.0,0.0,0.0,0.316,0.3428,0.3695,0.3963,0.423,0.4497,0.4765],[0.0,0.0,0.0,0.0,0.0,0.0,0.3365,0.3648,0.393,0.4213,0.4496,0.4778,0.5061],[0.0,0.0,0.0,0.0,0.0,0.0,0.3586,0.3884,0.4182,0.448,0.4779,0.5077,0.5375],[0.0,0.0,0.0,0.0,0.0,0.0,0.3823,0.4137,0.4451,0.4765,0.5079,0.5393,0.5707],[0.0,0.0,0.0,0.0,0.0,0.0,0.4077,0.4408,0.4738,0.5068,0.5398,0.5729,0.6059],[0.0,0.0,0.0,0.0,0.0,0.0,0.435,0.4696,0.5043,0.539,0.5737,0.6083,0.643],[0.0,0.0,0.0,0.0,0.0,0.0,0.464,0.5004,0.5367,0.5731,0.6095,0.6458,0.6822],[0.0,0.0,0.0,0.0,0.0,0.4569,0.495,0.5331,0.5712,0.6092,0.6473,0.6854,0.7234],[0.0,0.0,0.0,0.0,0.0,0.4881,0.528,0.5678,0.6076,0.6474,0.6872,0.727,0.7668],[0.0,0.0,0.0,0.0,0.0,0.5213,0.5629,0.6045,0.6461,0.6877,0.7293,0.7709,0.8125],[0.0,0.0,0.0,0.0,0.0,0.5566,0.6,0.6434,0.6868,0.7302,0.7736,0.817,0.8604],[0.0,0.0,0.0,0.0,0.0,0.594,0.6392,0.6845,0.7297,0.775,0.8202,0.8655,0.9107],[0.0,0.0,0.0,0.0,0.0,0.6336,0.6807,0.7278,0.775,0.8221,0.8692,0.9163,0.9635],[0.0,0.0,0.0,0.0,0.0,0.6754,0.7244,0.7735,0.8225,0.8715,0.9206,0.9696,1.019],[0.0,0.0,0.0,0.0,0.0,0.7196,0.7705,0.8215,0.8725,0.9235,0.9744,1.025,1.076],[0.0,0.0,0.0,0.0,0.0,0.7661,0.8191,0.872,0.925,0.9779,1.031,1.084,1.137],[0.0,0.0,0.0,0.0,0.0,0.8151,0.87,0.925,0.98,1.035,1.09,1.145,1.2]],"NOx":[[0.3884,0.3884,0.3884,0.3884,0.3884,0.3884,0.3884,0.3884,0.3884,0.3884,0.3884,0.3884,0.3884],[0.0,0.0,0.0,0.0,0.0,0.0,0.3885,0.3973,0.4061,0.4149,0.4236,0.4324,0.4412],[0.0,0.0,0.0,0.0,0.0,0.0,0.3893,0.4094,0.4294,0.4494,0.4694,0.4894,0.5094],[0.0,0.0,0.0,0.0,0.0,0.0,0.3916,0.4253,0.4589,0.4926,0.5263,0.56,0.5936],[0.0,0.0,0.0,0.0,0.0,0.0,0.396,0.4458,0.4955,0.5453,0.5951,0.6449,0.6947],[0.0,0.0,0.0,0.0,0.0,0.0,0.4032,0.4715,0.5399,0.6082,0.6765,0.7449,0.8132],[0.0,0.0,0.0,0.0,0.0,0.0,0.414,0.5033,0.5926,0.682,0.7713,0.8606,0.95],[0.0,0.0,0.0,0.0,0.0,0.0,0.429,0.5417,0.6545,0.7673,0.8801,0.9928,1.106],[0.0,0.0,0.0,0.0,0.0,0.0,0.449,0.5876,0.7263,0.8649,1.004,1.142,1.281],[0.0,0.0,0.0,0.0,0.0,0.0,0.4746,0.6416,0.8086,0.9756,1.143,1.31,1.477],[0.0,0.0,0.0,0.0,0.0,0.0,0.5067,0.7045,0.9022,1.1,1.298,1.495,1.693],[0.0,0.0,0.0,0.0,0.0,0.0,0.5459,0.7768,1.008,1.239,1.47,1.701,1.932],[0.0,0.0,0.0,0.0,0.0,0.0,0.5928,0.8594,1.126,1.393,1.659,1.926,2.193],[0.0,0.0,0.0,0.0,0.0,0.0,0.6483,0.953,1.258,1.562,1.867,2.172,2.477],[0.0,0.0,0.0,0.0,0.0,0.0,0.713,1.058,1.404,1.749,2.094,2.439,2.785],[0.0,0.0,0.0,0.0,0.0,0.0,0.7877,1.176,1.564,1.952,2.341,2.729,3.117],[0.0,0.0,0.0,0.0,0.0,0.0,0.873,1.307,1.74,2.174,2.608,3.041,3.475],[0.0,0.0,0.0,0.0,0.0,0.0,0.9696,1.451,1.933,2.414,2.896,3.377,3.859],[0.0,0.0,0.0,0.0,0.0,0.0,1.078,1.61,2.142,2.674,3.206,3.738,4.269],[0.0,0.0,0.0,0.0,0.0,0.0,1.2,1.784,2.369,2.954,3.538,4.123,4.707],[0.0,0.0,0.0,0.0,0.0,0.0,1.335,1.975,2.614,3.254,3.894,4.534,5.174],[0.0,0.0,0.0,0.0,0.0,0.0,1.484,2.181,2.879,3.576,4.274,4.971,5.669],[0.0,0.0,0.0,0.0,0.0,0.0,1.648,2.406,3.163,3.921,4.678,5.436,6.193],[0.0,0.0,0.0,0.0,0.0,0.0,1.828,2.648,3.468,4.288,5.108,5.928,6.748],[0.0,0.0,0.0,0.0,0.0,0.0,2.024,2.909,3.794,4.679,5.564,6.449,7.334],[0.0,0.0,0.0,0.0,0.0,0.0,2.237,3.189,4.142,5.094,6.047,6.999,7.951],[0.0,0.0,0.0,0.0,0.0,0.0,2.468,3.49,4.512,5.535,6.557,7.579,8.601],[0.0,0.0,0.0,0.0,0.0,0.0,2.717,3.811,4.906,6.001,7.095,8.19,9.284],[0.0,0.0,0.0,0.0,0.0,0.0,2.985,4.155,5.324,6.493,7.663,8.832,10.0],[0.0,0.0,0.0,0.0,0.0,0.0,3.274,4.52,5.767,7.013,8.26,9.506,10.75],[0.0,0.0,0.0,0.0,0.0,0.0,3.583,4.909,6.235,7.561,8.887,10.21,11.54],[0.0,0.0,0.0,0.0,0.0,2.504,3.913,5.321,6.729,8.137,9.546,10.95,12.36],[0.0,0.0,0.0,0.0,0.0,2.772,4.265,5.758,7.25,8.743,10.24,11.73,13.22],[0.0,0.0,0.0,0.0,0.0,3.06,4.64,6.219,7.799,9.379,10.96,12.54,14.12],[0.0,0.0,0.0,0.0,0.0,3.369,5.038,6.707,8.376,10.05,11.71,13.38,15.05],[0.0,0.0,0.0,0.0,0.0,3.7,5.461,7.221,8.982,10.74,12.5,14.27,16.03],[0.0,0.0,0.0,0.0,0.0,4.053,5.908,7.763,9.618,11.47,13.33,15.18,17.04],[0.0,0.0,0.0,0.0,0.0,4.429,6.381,8.333,10.28,12.24,14.19,16.14,18.09],[0.0,0.0,0.0,0.0,0.0,4.829,6.88,8.931,10.98,13.03,15.08,17.14,19.19],[0.0,0.0,0.0,0.0,0.0,5.253,7.406,9.559,11.71,13.86,16.02,18.17,20.32],[0.0,0.0,0.0,0.0,0.0,5.703,7.96,10.22,12.47,14.73,16.99,19.24,21.5]],"fuel":[[74.24,74.24,74.24,74.24,74.24,74.24,74.24,74.24,74.24,74.24,74.24,74.24,74.24],[0.0,0.0,0.0,0.0,0.0,0.0,76.78,81.03,85.28,89.53,93.78,98.03,102.3],[0.0,0.0,0.0,0.0,0.0,0.0,79.78,88.44,97.1,105.8,114.4,123.1,131.7],[0.0,0.0,0.0,0.0,0.0,0.0,83.33,96.56,109.8,123.0,136.2,149.5,162.7],[0.0,0.0,0.0,0.0,0.0,0.0,87.53,105.5,123.4,141.4,159.3,177.3,195.3],[0.0,0.0,0.0,0.0,0.0,0.0,92.45,115.3,138.1,161.0,183.8,206.6,229.5],[0.0,0.0,0.0,0.0,0.0,0.0,98.19,126.1,153.9,181.8,209.7,237.6,265.5],[0.0,0.0,0.0,0.0,0.0,0.0,104.8,137.9,171.0,204.1,237.1,270.2,303.3],[0.0,0.0,0.0,0.0,0.0,0.0,112.5,150.9,189.3,227.8,266.2,304.6,343.1],[0.0,0.0,0.0,0.0,0.0,0.0,121.2,165.1,209.1,253.0,297.0,340.9,384.9],[0.0,0.0,0.0,0.0,0.0,0.0,131.0,180.7,230.3,279.9,329.5,379.2,428.8],[0.0,0.0,0.0,0.0,0.0,0.0,142.2,197.6,253.1,308.5,364.0,419.4,474.9],[0.0,0.0,0.0,0.0,0.0,0.0,154.6,216.1,277.5,339.0,400.4,461.8,523.3],[0.0,0.0,0.0,0.0,0.0,0.0,168.5,236.1,303.7,371.3,438.9,506.5,574.1],[0.0,0.0,0.0,0.0,0.0,0.0,183.9,257.8,331.7,405.6,479.5,553.4,627.3],[0.0,0.0,0.0,0.0,0.0,0.0,200.9,281.3,361.6,442.0,522.4,602.7,683.1],[0.0,0.0,0.0,0.0,0.0,0.0,219.6,306.6,393.6,480.6,567.5,654.5,741.5],[0.0,0.0,0.0,0.0,0.0,0.0,240.1,333.8,427.6,521.4,615.1,708.9,802.7],[0.0,0.0,0.0,0.0,0.0,0.0,262.4,363.1,463.8,564.5,665.2,765.9,866.6],[0.0,0.0,0.0,0.0,0.0,0.0,286.7,394.5,502.3,610.1,717.9,825.7,933.5],[0.0,0.0,0.0,0.0,0.0,0.0,313.0,428.1,543.1,658.2,773.2,888.3,1003.0],[0.0,0.0,0.0,0.0,0.0,0.0,341.5,464.0,586.4,708.9,831.3,953.8,1076.0],[0.0,0.0,0.0,0.0,0.0,0.0,372.2,502.2,632.2,762.3,892.3,1022.0,1152.0],[0.0,0.0,0.0,0.0,0.0,0.0,405.1,542.9,680.7,818.4,956.2,1094.0,1232.0],[0.0,0.0,0.0,0.0,0.0,0.0,440.5,586.1,731.8,877.4,1023.0,1169.0,1314.0],[0.0,0.0,0.0,0.0,0.0,0.0,478.3,632.0,785.7,939.4,1093.0,1247.0,1400.0],[0.0,0.0,0.0,0.0,0.0,0.0,518.7,680.6,842.5,1004.0,1166.0,1328.0,1490.0],[0.0,0.0,0.0,0.0,0.0,0.0,561.8,732.0,902.3,1073.0,1243.0,1413.0,1583.0],[0.0,0.0,0.0,0.0,0.0,0.0,607.6,786.4,965.1,1144.0,1323.0,1501.0,1680.0],[0.0,0.0,0.0,0.0,0.0,0.0,656.2,843.7,1031.0,1219.0,1406.0,1593.0,1781.0],[0.0,0.0,0.0,0.0,0.0,0.0,707.8,904.0,1100.0,1297.0,1493.0,1689.0,1885.0],[0.0,0.0,0.0,0.0,0.0,557.0,762.3,967.6,1173.0,1378.0,1583.0,1789.0,1994.0],[0.0,0.0,0.0,0.0,0.0,605.5,819.9,1034.0,1249.0,1463.0,1678.0,1892.0,2106.0],[0.0,0.0,0.0,0.0,0.0,657.0,880.7,1104.0,1328.0,1552.0,1776.0,1999.0,2223.0],[0.0,0.0,0.0,0.0,0.0,711.6,944.8,1178.0,1411.0,1644.0,1878.0,2111.0,2344.0],[0.0,0.0,0.0,0.0,0.0,769.4,1012.0,1255.0,1498.0,1741.0,1983.0,2226.0,2469.0],[0.0,0.0,0.0,0.0,0.0,830.5,1083.0,1336.0,1588.0,1841.0,2093.0,2346.0,2599.0],[0.0,0.0,0.0,0.0,0.0,894.9,1157.0,1420.0,1683.0,1945.0,2208.0,2470.0,2733.0],[0.0,0.0,0.0,0.0,0.0,962.8,1235.0,1508.0,1781.0,2053.0,2326.0,2599.0,2871.0],[0.0,0.0,0.0,0.0,0.0,1034.0,1317.0,1600.0,1883.0,2166.0,2449.0,2732.0,3014.0],[0.0,0.0,0.0,0.0,0.0,1109.0,1403.0,1696.0,1989.0,2283.0,2576.0,2869.0,3162.0]]} } };

SW.FUEL_DENSITY = 0.75; // g/ml, mg fuel -> ml
SW.emission = function (vt, v, a, dt, grade) {
  const r = { CO2: 0, CO: 0, HC: 0, NOx: 0, PMx: 0, fuel: 0, elec: 0 };
  const cls = vt.emissionClass;
  if (cls === 'zero') return r;
  const aeff = a + 9.81 * (grade || 0);
  if (cls === 'Energy') {
    const m = (vt.mass || 1830) / 1830, cd = (vt.cda || 0.6) / 0.6, av = aeff * v;
    const whs = 0.50183 * m * Math.max(av, 0) + 0.53125 * m * Math.min(av, 0) + 0.041474 * m * v + 1.7718e-4 * cd * v * v * v;
    r.elec = whs * dt; // Wh
    return r;
  }
  const tab = SW.EMI_TABLE[cls];
  const keys = ['CO', 'CO2', 'HC', 'PMx', 'NOx', 'fuel'];
  if (tab) {
    const fv = Math.max(0, Math.min(tab.nv - 1.001, (v - tab.v0) / tab.dv)), fa = Math.max(0, Math.min(tab.na - 1.001, (aeff - tab.a0) / tab.da));
    const i = Math.floor(fv), j = Math.floor(fa), u = fv - i, w = fa - j;
    for (const k of keys) {
      const T = tab.data[k];
      const val = (T[i][j] * (1 - u) + T[i + 1][j] * u) * (1 - w) + (T[i][j + 1] * (1 - u) + T[i + 1][j + 1] * u) * w;
      r[k] = Math.max(0, val) * dt / 1000;
    }
  } else {
    const C = SW.EMI_HBEFA[cls] || SW.EMI_HBEFA.PC_G_EU4;
    const kv = v * 3.6, A = Math.max(-3, Math.min(3, aeff));
    for (const k of keys) {
      const c = C[k];
      r[k] = Math.max(0, c[0] + c[1] * A * kv + c[2] * A * A * kv + c[3] * kv + c[4] * kv * kv + c[5] * kv * kv * kv) * dt / 1000;
    }
  }
  r.fuel = r.fuel / SW.FUEL_DENSITY; // g -> ml
  return r;
};

/* ---------- simulation ---------- */
class Sim {
  constructor(net, demand, add, cfg) {
    this.net = net; this.demand = demand; this.add = add || SW.newAdditional(); this.cfg = Object.assign(SW.defaultConfig(), cfg || {});
    this.hooks = {};
    this.reset();
  }
  reset() {
    this.T = SW.buildTopo(this.net);
    this.rand = SW.rng(this.cfg.seed);
    this.t = this.cfg.begin; this.dt = this.cfg.stepLength;
    this.vehs = new Map(); this.arrived = []; this.tripinfo = []; this.departed = 0; this.loaded = 0; this.teleports = 0; this.collisions = 0;
    this.stepDeparted = []; this.stepArrived = [];
    this.pending = []; this.waitingInsert = [];
    this.vidCounter = 0;
    this.summary = []; this.totals = { CO2: 0, CO: 0, HC: 0, NOx: 0, PMx: 0, fuel: 0, elec: 0, dist: 0 };
    this.messages = [];
    // routes / vehicles
    const routes = {};
    for (const r of Object.values(this.demand.routes)) routes[r.id] = r.edges.slice();
    this.routes = routes;
    for (const v of this.demand.vehicles) {
      let edges = v.route ? (routes[v.route] || (Array.isArray(v.route) ? v.route : null)) : null;
      if (v.edges) edges = v.edges;
      if (!edges && v.from && v.to) edges = SW.route(this.T, v.from, v.to, v.via);
      if (!edges || !edges.length) { this.warn(`Kendaraan ${v.id}: rute tidak ditemukan`); continue; }
      this.pending.push({ id: v.id, type: v.type, edges, depart: +v.depart || 0, departLane: v.departLane || 'best', departSpeed: v.departSpeed || 'max', color: v.color, stops: v.stops });
    }
    this.flowState = this.demand.flows.map(f => {
      let edges = f.route ? routes[f.route] : null;
      if (f.edges) edges = f.edges;
      if (!edges && f.from && f.to) edges = SW.route(this.T, f.from, f.to, f.via);
      if (!edges) this.warn(`Flow ${f.id}: rute ${f.from} → ${f.to} tidak ditemukan`);
      const begin = +f.begin || 0, end = f.end !== undefined && f.end !== '' ? +f.end : this.cfg.end;
      let period = null;
      if (f.vehsPerHour) period = 3600 / +f.vehsPerHour;
      else if (f.period) period = +f.period;
      else if (f.number) period = (end - begin) / Math.max(1, +f.number);
      return { f, edges, begin, end, period, prob: f.probability ? +f.probability : null, next: begin, count: 0 };
    });
    this.pending.sort((a, b) => a.depart - b.depart);
    this.loaded = this.pending.length;
    // traffic lights
    this.tls = {};
    for (const id of this.T.tlsNodes) {
      const prog = this.net.tls[id];
      const st = { id, prog, phase: 0, start: this.t, override: null, endOverride: null };
      let off = (prog.offset || 0) % Math.max(1, prog.phases.reduce((s, p) => s + p.duration, 0));
      while (off > 0) { const d = prog.phases[st.phase].duration; if (off >= d) { off -= d; st.phase = (st.phase + 1) % prog.phases.length; } else { st.start -= off; off = 0; } }
      this.tls[id] = st;
    }
    // detectors
    this.e1 = this.add.e1.filter(d => this.T.lanes[d.lane]).map(d => ({ d, lane: this.T.lanes[d.lane], last: { n: 0, speed: -1, occ: 0, ids: [] }, acc: this.newE1Acc(), intervals: [], lastDetect: -1, lastIntervalN: 0 }));
    this.e2 = this.add.e2.filter(d => this.T.lanes[d.lane]).map(d => ({ d, lane: this.T.lanes[d.lane], last: { n: 0, speed: -1, occ: 0, jamM: 0, jamV: 0, halting: 0, ids: [] }, acc: this.newE2Acc(), intervals: [] }));
    this.edgeStats = {};
    for (const id of Object.keys(this.T.edges)) this.edgeStats[id] = { n: 0, speed: -1, halting: 0, co2: 0, ids: [], acc: { sampled: 0, speedSum: 0, entered: 0, co2: 0, wait: 0 }, intervals: [] };
    this.intervalStart = this.t;
    this.approach = {}; this.edgeCls = {};
    this.approachEdges = Object.values(this.T.edges).filter(te => this.T.nodes[te.to].neighbors.size >= 3).map(te => te.id);
    this.speedOverrides = {};
    this.setupExtras();
    if (this.hooks.reset) this.hooks.reset(this);
  }
  warn(m) { this.messages.push({ t: this.t, m }); if (this.messages.length > 300) this.messages.shift(); }
  newE1Acc() { return { n: 0, speedSum: 0, occTime: 0, lenSum: 0 }; }
  newE2Acc() { return { steps: 0, nSum: 0, speedSum: 0, speedN: 0, occSum: 0, maxJam: 0, jamSum: 0, entered: 0 }; }

  /* ----- vehicle creation ----- */
  vType(id) { return this.demand.vTypes[id] || this.demand.vTypes.DEFAULT_VEHTYPE || SW.makeVType('DEFAULT_VEHTYPE', 'passenger'); }
  bestLanes(edgeId, nextId) {
    const te = this.T.edges[edgeId];
    if (!nextId) return te.lanes.map(l => l.index);
    const s = this.T.lanesTo[edgeId + '>' + nextId];
    return s ? [...s] : [];
  }
  tryInsert(p) {
    const T = this.T, te = T.edges[p.edges[0]];
    if (!te) return 'drop';
    const vt = this.vType(p.type);
    let lanes = this.bestLanes(te.id, p.edges[1]);
    if (!lanes.length) lanes = te.lanes.map(l => l.index);
    if (p.departLane !== 'best' && p.departLane !== 'free' && p.departLane !== 'random' && p.departLane !== undefined && !isNaN(+p.departLane)) lanes = [+p.departLane].filter(i => i < te.lanes.length);
    if (p.departLane === 'random') lanes = [lanes[Math.floor(this.rand() * lanes.length)]];
    let best = null, bestSpace = -Infinity;
    const sub = this.isSublane(vt);
    for (const li of lanes) {
      const L = te.lanes[li];
      // vehicles about to enter this lane from a junction also occupy its start
      const incoming = [];
      for (const c of (this.T.connsInto && this.T.connsInto[L.id]) || []) for (const o of c.vehs) incoming.push({ o, front: -(c.length - o.pos) });
      for (const lat of sub ? this.latSlots(L, vt) : [0]) {
        let space = L.length + 1000, vL = 99;
        for (const o of L.vehs) { if (!this.latOverlap(lat, vt.width, o.lat || 0, o.vt.width)) continue; const rear = o.pos - o.vt.length; if (rear < space) { space = rear; vL = o.v; } }
        for (const { o, front } of incoming) { if (!this.latOverlap(lat, vt.width, o.lat || 0, o.vt.width)) continue; const rear = front - o.vt.length; if (rear < space) { space = rear; vL = o.v; } }
        if (space > bestSpace + 0.5) { bestSpace = space; best = { L, space, vL, lat }; }
      }
    }
    if (!best) return 'wait';
    const need = vt.length + vt.minGap;
    if (best.space < need) return 'wait';
    const sf = Math.max(0.2, Math.min(2, (vt.speedFactor || 1) * (1 + (vt.speedDev || 0) * this.rand.normal(0, 1))));
    const vmax = Math.min(vt.maxSpeed, best.L.speed * sf);
    let v = 0;
    if (p.departSpeed === 'max' || p.departSpeed === 'desired' || p.departSpeed === undefined) {
      const gap = best.space - vt.length - vt.minGap;
      v = best.vL >= 99 ? vmax : Math.min(vmax, this.krausSafe(0, best.vL, gap, vt));
      if (p.departSpeed === 'desired' && v < vmax * 0.99) return 'wait';
    } else v = Math.min(vmax, +p.departSpeed || 0);
    const veh = {
      id: p.id, vt, typeId: vt.id, route: p.edges.slice(), ri: 0, seg: best.L, kind: 'lane', pos: vt.length, v, a: 0, speedFactor: sf,
      latOff: 0, lastLC: -99, wait: 0, waitTotal: 0, timeLoss: 0, depart: this.t, departDelay: this.t - p.depart, dist: 0,
      em: { CO2: 0, CO: 0, HC: 0, NOx: 0, PMx: 0, fuel: 0, elec: 0 }, emStep: { CO2: 0, CO: 0, HC: 0, NOx: 0, PMx: 0, fuel: 0, elec: 0 },
      color: p.color || vt.color, committed: null, forcedSpeed: null, forcedLane: null, battery: vt.emissionClass === 'Energy' ? (vt.batteryCapacity || 35000) * 0.8 : 0,
      stopTimer: 0, nextConn: null, lat: best.lat || 0, latT: -99,
      stops: this.resolveStops(p.stops, p.edges), dwell: 0, nextNgetem: vt.ngetem ? this.rand() * 1000 / Math.max(0.1, vt.ngetem.perKm) : Infinity
    };
    best.L.vehs.push(veh);
    veh.edgeEnter = this.t; this.countEdge(te.id, veh);
    this.vehs.set(veh.id, veh);
    this.departed++; this.stepDeparted.push(veh.id);
    return 'ok';
  }
  addVehicle(id, edges, typeId, departLane, departSpeed) {
    if (this.vehs.has(id)) throw new Error('Kendaraan ' + id + ' sudah ada');
    this.waitingInsert.push({ id, type: typeId, edges, depart: this.t, departLane: departLane || 'best', departSpeed: departSpeed || 'max' });
    this.loaded++;
  }

  /* ----- car-following ----- */
  krausSafe(v, vL, gap, vt) {
    if (gap <= 0) return 0;
    const b = vt.decel, tau = vt.tau;
    return Math.max(0, -b * tau + Math.sqrt(b * b * tau * tau + vL * vL + 2 * b * gap));
  }
  safeOf(veh, o) {
    if (o.vt !== undefined) return o.vt;
    return this.krausSafe(veh.v, o.vL, o.stop ? o.g : o.g - veh.vt.minGap, veh.vt);
  }
  gradeOf(veh) { return veh.kind === 'lane' && veh.seg.elev ? SW.gradeAt(veh.seg.elev, veh.pos) : 0; }
  nextSpeed(veh, obstacles, vmax) {
    const vt0 = veh.vt, v = veh.v, dt = this.dt;
    const grade = this.gradeOf(veh);
    // uphill reduces available acceleration (heavy vehicles more), downhill increases it slightly
    const heavy = (vt0.mass || 1500) > 5000 ? 1.4 : 1;
    const accEff = Math.max(0.25, Math.min(vt0.accel * 1.3, vt0.accel - 9.81 * grade * heavy));
    const vt = accEff === vt0.accel ? vt0 : Object.assign(Object.create(vt0), { accel: accEff });
    if (vt.carFollowModel === 'IDM') {
      const a0 = vt.accel, b = vt.decel, s0 = vt.minGap, T = vt.tau, d = 4;
      const v0 = Math.max(0.1, vmax);
      let acc = a0 * (1 - Math.pow(v / v0, d));
      for (const o of obstacles) {
        const s = Math.max(0.1, o.stop ? o.g + s0 - 0.3 : o.g);
        const ss = s0 + Math.max(0, v * T + v * (v - o.vL) / (2 * Math.sqrt(a0 * b)));
        acc = Math.min(acc, a0 * (1 - Math.pow(v / v0, d) - (ss / s) * (ss / s)));
      }
      let vn = Math.max(0, v + acc * dt);
      vn = Math.max(vn, v - vt.emergencyDecel * dt);
      for (const o of obstacles) if (o.g <= 0.2 && o.vL < 0.1) vn = 0;
      return Math.min(vn, vmax + 0.01);
    }
    // Krauss (SUMO default)
    let vs = Infinity;
    for (const o of obstacles) vs = Math.min(vs, this.safeOf(veh, o));
    let vn = Math.min(vmax, v + vt.accel * dt, vs);
    if (vt.sigma > 0) vn = Math.max(0, vn - this.rand() * vt.sigma * vt.accel * dt * (vn < vt.accel * dt ? 0.5 : 1));
    vn = Math.max(0, Math.max(vn, Math.min(vs, v - vt.emergencyDecel * dt)));
    return vn;
  }
  /* ---- sublane (motorcycles filtering between cars) ---- */
  isSublane(vt) { return this.cfg.sublane !== false && (vt.vClass === 'motorcycle' || vt.vClass === 'bicycle' || vt.latAlignment === 'arbitrary'); }
  latOverlap(la, wa, lb, wb) { return Math.abs(la - lb) < (wa + wb) / 2 + 0.15; }
  overlaps(a, b) { return this.latOverlap(a.lat || 0, a.vt.width, b.lat || 0, b.vt.width); }
  latLimits(L, vt) {
    // allowed lateral range inside lane L; may straddle a lane line shared with a same-direction lane
    const W = SW.LANE_W, half = W / 2 - vt.width / 2, te = L.edge, n = te.lanes.length;
    const hiSide = n > 1 ? Math.sign(te.lanes[1].off - te.lanes[0].off) : (this.net.lefthand ? -1 : 1);
    // side of lane 0 that faces the curb (outer side)
    const curbSide = -hiSide;
    const ext = side => {
      const neighbor = side === hiSide ? L.index < n - 1 : L.index > 0;
      if (neighbor) return 0.5;
      return side === curbSide ? 0.35 : 0.1;
    };
    return [-(half + ext(-1)), half + ext(1)];
  }
  latSlots(L, vt) { const [lo, hi] = this.latLimits(L, vt); return [0, hi, lo, hi / 2, lo / 2]; }
  laneLeader(L, veh, fromPos, lat) {
    let best = null;
    const la = lat !== undefined ? lat : (veh.lat || 0);
    // the binding leader is the overlapping vehicle whose REAR is closest (matters when narrow vehicles share a lane)
    for (const o of L.vehs) if (o !== veh && o.pos > fromPos && (!best || o.pos - o.vt.length < best.pos - best.vt.length) && this.latOverlap(la, veh.vt.width, o.lat || 0, o.vt.width)) best = o;
    return best;
  }
  laneLast(L, veh) { let best = null; for (const o of L.vehs) if ((!veh || this.overlaps(veh, o)) && (!best || o.pos - o.vt.length < best.pos - best.vt.length)) best = o; return best; }
  lateralMove(veh) {
    if (veh.kind !== 'lane' || !this.isSublane(veh.vt)) return;
    const L = veh.seg, vt = veh.vt, dt = this.dt;
    const [lo, hi] = this.latLimits(L, vt);
    if (this.t - veh.latT >= 1 || veh.latTarget === undefined) {
      veh.latT = this.t;
      const vmax = Math.min(vt.maxSpeed, L.speed * veh.speedFactor);
      const score = lat => {
        const ld = this.laneLeader(L, veh, veh.pos - 0.01, lat);
        if (!ld) return vmax + 1 - Math.abs(lat) * 0.05;
        const gap = ld.pos - ld.vt.length - veh.pos - vt.minGap;
        return Math.min(vmax, this.krausSafe(veh.v, ld.v, gap, vt), ld.v + gap / 4) + gap * 0.01;
      };
      let best = Math.max(lo, Math.min(hi, veh.lat)), bs = score(best) + 0.4;
      for (const c of [0, hi, lo, hi / 2, lo / 2]) { const sc = score(c); if (sc > bs) { bs = sc; best = c; } }
      veh.latTarget = best;
    }
    const tgt = Math.max(lo, Math.min(hi, veh.latTarget));
    const d = tgt - veh.lat;
    if (Math.abs(d) < 0.01) return;
    const nl = veh.lat + Math.sign(d) * Math.min(Math.abs(d), 1.2 * dt);
    // do not slide into a vehicle that is alongside
    for (const o of L.vehs) {
      if (o === veh) continue;
      const alongside = o.pos > veh.pos - vt.length - 0.5 && o.pos - o.vt.length < veh.pos + 0.5;
      const phys = l => Math.abs(l - (o.lat || 0)) < (vt.width + o.vt.width) / 2 + 0.05;
      if (alongside && phys(nl) && Math.abs(nl - (o.lat || 0)) < Math.abs(veh.lat - (o.lat || 0))) { veh.latTarget = veh.lat; return; }
    }
    veh.lat = nl;
  }

  connFor(veh) {
    if (veh.kind !== 'lane') return null;
    const next = veh.route[veh.ri + 1];
    if (!next) return null;
    const outs = veh.seg.out.filter(c => c.to === next);
    if (!outs.length) return null;
    if (outs.length === 1) return outs[0];
    // several target lanes: choose the one best for the following edge
    const nn = veh.route[veh.ri + 2];
    if (nn) { const good = outs.filter(c => this.bestLanes(c.to, nn).includes(c.toLane)); if (good.length) return good[0]; }
    return outs[0];
  }
  linkState(c) {
    if (!c.tl) return null;
    const st = this.tls[c.tl];
    if (!st) return null;
    const s = st.override || st.prog.phases[st.phase].state;
    return s[c.tlIndex] || 'r';
  }
  canPass(veh, c, dEnd) {
    if (veh.committed === c.id) return true;
    const vt = veh.vt, v = veh.v;
    const brake = v * v / (2 * vt.decel);
    const horizon = brake + v * this.dt * 2 + 6;
    if (dEnd > horizon) return true;
    let st = this.linkState(c);
    const emergency = vt.vClass === 'emergency';
    if (st === 'r' || st === 's' || st === 'u') {
      if (!emergency) return false;
      st = 'g';
    }
    let clearing = false;
    if (st === 'y' || st === 'Y') {
      // permissive left turner that waited at the line may clear during yellow
      if ((c.dir === this.T.far || c.dir === 't') && veh.wait > 2 && dEnd < 3) { clearing = true; st = 'g'; }
      else if (dEnd > brake + v * this.dt) return false;
    }
    let yieldList = c.yieldTo;
    if (st === 'G' || st === 'O' || st === 'y' || st === 'Y') yieldList = [];
    else if (st === 'g') yieldList = c.foes.filter(f => { const fs = this.linkState(f); return fs === 'G' || fs === 'y' || (fs === 'g' && c.yieldTo.includes(f)); });
    void clearing;
    const myEta = v > 0.5 ? dEnd / v : Math.sqrt(2 * Math.max(0.1, dEnd) / vt.accel) + 0.5;
    const vc = Math.max(5, Math.min(c.speed, v + 3));
    const myLeave = myEta + (c.length * 0.7 + vt.length) / vc + 0.8;
    for (const f of yieldList) {
      if (st === null || st === undefined) { /* priority junction */ }
      else { const fs = this.linkState(f); if (fs === 'r' || fs === 's') continue; }
      for (const o of f.vehs) if (o.pos < f.length * 0.92 + o.vt.length) return false;
      const fst = this.linkState(f);
      for (const ap of f.approaching) {
        if (ap.veh === veh) continue;
        if (fst === 'y' && ap.dEnd > ap.veh.v * ap.veh.v / (2 * ap.veh.vt.decel) + 1 && ap.veh.committed !== f.id) continue;
        if (veh.wait > 12 && ap.veh.v < 0.3 && st === null) continue; // deadlock breaker
        if (ap.eta < myLeave && ap.eta < 12) return false;
      }
    }
    // keep clear: do not enter if target lane is blocked
    const tl = c.toL, last = this.laneLast(tl, veh);
    if (last && last.pos - last.vt.length < vt.length + vt.minGap * 0.5 && last.v < 1.5) return false;
    for (const o of c.vehs) if (o.pos < vt.length + 1 && o.v < 0.5) return false;
    if (dEnd <= brake + v * this.dt + 1) veh.committed = c.id;
    return true;
  }
  obstaclesFor(veh) {
    const vt = veh.vt, obs = [];
    const look = Math.max(80, veh.v * veh.v / (2 * vt.decel) + veh.v * 4);
    const addLeader = (o, offset) => obs.push({ g: offset + o.pos - o.vt.length - veh.pos, vL: o.v, id: o.id });
    if (veh.kind === 'lane') {
      const L = veh.seg;
      const ld = this.laneLeader(L, veh, veh.pos);
      if (ld) { addLeader(ld, 0); }
      this.extraObstacles(veh, L, 0, obs, true);
      const dEnd = L.length - veh.pos;
      if (veh.ri >= veh.route.length - 1) return obs;
      const c = veh.nextConn;
      // speed limit inside the junction (turns) — applies even when following a leader
      const vTurn = c ? c.speed * (veh.speedFactor || 1) : Infinity;
      if (c && vTurn < veh.v + vt.accel * this.dt) obs.push({ vt: Math.sqrt(vTurn * vTurn + 2 * vt.decel * Math.max(0, dEnd - veh.v * this.dt - 0.2)), g: dEnd, vL: vTurn });
      if (ld && ld.pos - veh.pos < look) return obs;
      if (!c) { obs.push({ g: dEnd - 0.2, vL: 0, stop: true }); return obs; }
      if (!this.canPass(veh, c, dEnd)) { obs.push({ g: dEnd - 0.5, vL: 0, stop: true }); return obs; }
      this.leadersThroughConn(veh, c, L.length, obs);
    } else {
      const c = veh.seg;
      let ld = null;
      for (const o of c.vehs) if (o !== veh && o.pos > veh.pos && (!ld || o.pos - o.vt.length < ld.pos - ld.vt.length) && this.overlaps(veh, o)) ld = o;
      if (ld) addLeader(ld, 0); else this.leadersThroughConn(veh, c, 0, obs, true);
    }
    return obs;
  }
  leadersThroughConn(veh, c, base, obs, onConn) {
    // base: position (in veh's own segment coords) where conn c starts
    const vt = veh.vt;
    let found = false;
    if (!onConn) {
      let last = null; for (const o of c.vehs) if (this.overlaps(veh, o) && (!last || o.pos < last.pos)) last = o;
      if (last) { obs.push({ g: base + last.pos - last.vt.length - veh.pos, vL: last.v }); found = true; }
    }
    const myRemain = onConn ? c.length - veh.pos : base - veh.pos + c.length;
    this.extraObstacles(veh, c.toL, myRemain, obs, false);
    // merging vehicles on other conns towards same lane
    for (const f of c.foes) {
      if (f.to !== c.to || f.toLane !== c.toLane) continue;
      for (const o of f.vehs) {
        const rem = f.length - o.pos;
        if (rem < myRemain - 0.5) obs.push({ g: myRemain - rem - o.vt.length, vL: o.v });
      }
    }
    if (found) return;
    const tl = c.toL; const last = this.laneLast(tl, veh);
    if (last) obs.push({ g: myRemain + last.pos - last.vt.length, vL: last.v });
    else if (vt) {
      // look one edge further for a stop
      const nidx = veh.ri + 1 + (onConn ? 0 : 0);
      const isLast = (onConn ? veh.ri + 1 : veh.ri + 1) >= veh.route.length - 1;
      if (!isLast && tl.length + myRemain < 120) {
        const nextNext = veh.route[nidx + 1];
        const has = tl.out.some(cc => cc.to === nextNext);
        if (!has) obs.push({ g: myRemain + tl.length - 0.5, vL: 0 });
        else {
          const cc = tl.out.find(x => x.to === nextNext);
          const s = this.linkState(cc);
          if (s === 'r' && vt.vClass !== 'emergency') obs.push({ g: myRemain + tl.length - 0.5, vL: 0 });
        }
      }
    }
  }

  /* last line of defence: if a vehicle ended a step overlapping the one ahead (e.g. the leader was stopped hard
     at a blocked junction exit), place it right behind and count it as a near-collision */
  resolveOverlaps() {
    const segs = [...Object.values(this.T.lanes), ...this.T.conns];
    for (const seg of segs) {
      const vs = seg.vehs; if (vs.length < 2) continue;
      vs.sort((a, b) => b.pos - a.pos);
      for (let i = 1; i < vs.length; i++) {
        const B = vs[i];
        for (let j = i - 1; j >= 0; j--) {
          const A = vs[j];
          if (A.pos - A.vt.length - B.pos > 5) break;
          if (Math.abs((A.lat || 0) - (B.lat || 0)) >= (A.vt.width + B.vt.width) / 2) continue;
          const lim = A.pos - A.vt.length - 0.1;
          if (B.pos > lim && B.pos > 0.05) { B.pos = Math.max(0.01, lim); B.v = Math.min(B.v, A.v); this.collisions++; }
        }
      }
    }
  }
  /* hard safety rule: never move onto a segment whose start is still occupied (prevents overlaps when two
     junction movements merge in the same step or a vehicle was just inserted) */
  entryBlocked(seg, veh, front, entered) {
    const w = veh.vt.width, la = veh.lat || 0, rear = front - veh.vt.length;
    const test = o => {
      if (o === veh || Math.abs(la - (o.lat || 0)) >= (w + o.vt.width) / 2) return false;
      return o.pos - o.vt.length < front + 0.05 && o.pos > rear - 0.05 && o.seg === seg;
    };
    for (const o of seg.vehs) if (test(o)) return true;
    for (const o of entered[seg.id] || []) if (test(o)) return true;
    return false;
  }

  /* ----- statistics for PKJI (approach flows by vehicle class, delay, queues) ----- */
  pkjiClass(vt) { const c = vt.vClass; if (c === 'motorcycle') return 'SM'; if (c === 'bicycle') return 'KTB'; if (c === 'bus' || c === 'truck') return 'KB'; return 'KR'; }
  countEdge(edgeId, veh) {
    if (this.t < (this.cfg.warmup || 0)) return;
    const e = this.edgeCls[edgeId] = this.edgeCls[edgeId] || { KR: 0, KB: 0, SM: 0, KTB: 0 };
    e[this.pkjiClass(veh.vt)]++;
  }
  recordApproach(veh, L) {
    if (this.t < (this.cfg.warmup || 0)) return;
    const id = L.edge.id;
    const a = this.approach[id] = this.approach[id] || { n: 0, KR: 0, KB: 0, SM: 0, KTB: 0, delaySum: 0, stops: 0, maxQveh: 0, maxQm: 0, byDir: {} };
    a.n++; a[this.pkjiClass(veh.vt)]++;
    const vfree = Math.min(veh.vt.maxSpeed, L.speed * (veh.speedFactor || 1));
    const free = L.length / Math.max(1, vfree);
    const enter = veh.edgeEnter !== undefined ? veh.edgeEnter : this.t;
    a.delaySum += Math.max(0, (this.t - enter) - free);
    const c = veh.nextConn; if (c) a.byDir[c.dir] = (a.byDir[c.dir] || 0) + 1;
  }
  updateQueues() {
    if (this.t < (this.cfg.warmup || 0)) return;
    for (const id of this.approachEdges) {
      const te = this.T.edges[id];
      let qv = 0, qm = 0;
      for (const L of te.lanes) {
        let rear = L.length, n = 0;
        const hs = L.vehs.filter(v => v.v < 1.4).sort((a, b) => b.pos - a.pos);
        for (const v of hs) { if (rear - v.pos > 12) break; rear = v.pos - v.vt.length; n++; }
        qv += n; qm = Math.max(qm, L.length - rear);
      }
      const a = this.approach[id] = this.approach[id] || { n: 0, KR: 0, KB: 0, SM: 0, KTB: 0, delaySum: 0, stops: 0, maxQveh: 0, maxQm: 0, byDir: {} };
      a.maxQveh = Math.max(a.maxQveh, qv); a.maxQm = Math.max(a.maxQm, qm);
    }
  }

  /* ----- public transport stops, angkot "ngetem", pedestrian crossings ----- */
  setupExtras() {
    const T = this.T, add = this.add;
    this.busStops = {};
    for (const b of add.busStops || []) {
      const L = T.lanes[b.lane]; if (!L) continue;
      this.busStops[b.id] = { d: b, lane: L, endPos: Math.min(L.length - 0.5, +b.endPos), startPos: Math.max(0, +b.startPos), arrivals: 0, dwellSum: 0, waiting: [] };
    }
    this.crossings = [];
    this.peds = []; this.pedCounter = 0; this.pedStats = { crossed: 0, waitSum: 0, maxWait: 0 };
    for (const cr of add.crossings || []) {
      const te = T.edges[cr.edge]; if (!te) continue;
      const pos = Math.max(2, Math.min(te.length - 1, +cr.pos));
      const P = SW.geom.posAt(te.center, SW.geom.cum(te.center), pos);
      const parts = te.lanes.map(L => ({ lane: L, s: Math.max(1, Math.min(L.length - 0.5, SW.geom.distToPoly(P, L.shape).s)) }));
      const rev = te.rev && T.edges[te.rev];
      if (rev) for (const L of rev.lanes) parts.push({ lane: L, s: Math.max(1, Math.min(L.length - 0.5, SW.geom.distToPoly(P, L.shape).s)), rev: true });
      const width = parts.length * SW.LANE_W + 1;
      const type = cr.type || 'zebra';
      this.crossings.push({ d: cr, te, P, ang: P.a, parts, width, type, half: (cr.width || 4) / 2, phase: 'veh', phaseStart: this.t, waiting: 0, crossed: 0, waitSum: 0, rate: (+cr.pedPerHour || 0) / 3600, compliance: cr.compliance !== undefined ? +cr.compliance : 0.6, yields: new Map() });
    }
    this.crossByLane = {};
    for (const cr of this.crossings) for (const pt of cr.parts) (this.crossByLane[pt.lane.id] = this.crossByLane[pt.lane.id] || []).push([cr, pt]);
  }
  resolveStops(stops, edges) {
    if (!stops || !stops.length) return [];
    const out = [];
    for (const st of stops) {
      const b = this.busStops[st.busStop]; if (!b) { this.warn('Halte tidak dikenal: ' + st.busStop); continue; }
      if (!edges.includes(b.lane.edge.id)) { this.warn(`Halte ${st.busStop} tidak dilalui rute`); continue; }
      out.push({ busStop: st.busStop, edge: b.lane.edge.id, laneIndex: b.lane.index, endPos: b.endPos, duration: +st.duration || 20 });
    }
    return out;
  }
  pelicanVehState(cr) {
    if (cr.type === 'pelican') return cr.phase === 'veh' ? 'G' : cr.phase === 'vy' ? 'y' : 'r';
    return 'G';
  }
  /* is the vehicle approaching crossing part `pt` required to stop? */
  mustStopAtCrossing(veh, cr, pt, dist) {
    const v = veh.v, brake = v * v / (2 * veh.vt.decel);
    const canStop = dist > brake + v * this.dt;
    if (cr.type === 'pelican') {
      const vs = this.pelicanVehState(cr);
      if (vs === 'r') return true;
      if (vs === 'y') return canStop;
    }
    const walking = this.peds.some(p => p.cr === cr && p.state === 'walk');
    if (walking) return canStop || dist > 0.5;
    if (cr.type === 'tls' && pt.rev && cr.walkOk) return canStop && cr.waiting > 0;
    if (cr.type === 'zebra' && cr.waiting > 0 && canStop) {
      // driver compliance (Indonesia: often low) decided once per vehicle and crossing
      let y = cr.yields.get(veh.id);
      if (y === undefined) { y = this.rand() < cr.compliance; cr.yields.set(veh.id, y); }
      return y;
    }
    return false;
  }
  extraObstacles(veh, L, offset, obs, sameLane) {
    const look = Math.max(60, veh.v * veh.v / (2 * veh.vt.decel) + veh.v * 3);
    const list = this.crossByLane && this.crossByLane[L.id];
    if (list) for (const [cr, pt] of list) {
      const line = pt.s - cr.half - 1;
      const dist = offset + line - (sameLane ? veh.pos : 0);
      if (dist < -0.5 || dist > look) continue;
      if (sameLane && veh.pos - veh.vt.length > pt.s + cr.half) continue;
      if (this.mustStopAtCrossing(veh, cr, pt, dist)) obs.push({ g: Math.max(0, dist), vL: 0, stop: true, crossing: cr.d.id });
    }
    if (!sameLane) return;
    const st = veh.stops && veh.stops[0];
    if (st && st.edge === L.edge.id && L.index === st.laneIndex && veh.pos < st.endPos + 0.5 && !veh.dwell) obs.push({ g: Math.max(0, st.endPos - veh.pos), vL: 0, stop: true });
    if (veh.adhoc && veh.adhoc.edge === L.edge.id && L.index === 0 && veh.pos < veh.adhoc.pos + 0.5 && !veh.dwell) obs.push({ g: Math.max(0, veh.adhoc.pos - veh.pos), vL: 0, stop: true });
  }
  updateStops() {
    const dt = this.dt;
    for (const veh of this.vehs.values()) {
      if (veh.dwell > 0) {
        veh.dwell -= dt;
        if (veh.dwell <= 0) {
          veh.dwell = 0;
          if (veh.adhocActive) { veh.adhoc = null; veh.adhocActive = false; }
          else if (veh.stops.length) veh.stops.shift();
        }
        continue;
      }
      if (veh.kind !== 'lane') continue;
      const st = veh.stops[0];
      if (st && st.edge === veh.seg.edge.id) {
        if (veh.seg.index === st.laneIndex && Math.abs(veh.pos - st.endPos) < 1.5 && veh.v < 0.6) {
          veh.dwell = st.duration; const b = this.busStops[st.busStop]; if (b) { b.arrivals++; b.dwellSum += st.duration; }
          continue;
        }
        if (veh.pos > st.endPos + 2) { this.warn(`${veh.id} melewati halte ${st.busStop}`); veh.stops.shift(); }
      }
      // angkot: random curbside stops away from junctions
      const ng = veh.vt.ngetem;
      if (ng && !veh.adhoc) {
        veh.nextNgetem -= veh.v * dt;
        const L = veh.seg;
        if (veh.nextNgetem <= 0 && L.length - veh.pos > 60 && veh.pos > 15) {
          veh.adhoc = { edge: L.edge.id, pos: Math.min(L.length - 40, veh.pos + 20) };
          veh.nextNgetem = (0.3 + this.rand() * 1.4) * 1000 / Math.max(0.1, ng.perKm);
        }
      }
      if (veh.adhoc && veh.adhoc.edge === veh.seg.edge.id && veh.seg.index === 0 && Math.abs(veh.pos - veh.adhoc.pos) < 1.5 && veh.v < 0.6) {
        veh.dwell = ng.min + this.rand() * (ng.max - ng.min); veh.adhocActive = true;
      } else if (veh.adhoc && (veh.adhoc.edge !== veh.seg.edge.id || veh.pos > veh.adhoc.pos + 3)) veh.adhoc = null;
    }
  }
  updatePeds() {
    if (!this.crossings.length) return;
    const dt = this.dt;
    for (const cr of this.crossings) {
      // pedestrian demand
      if (cr.rate > 0 && this.rand() < cr.rate * dt) {
        const dir = this.rand() < 0.5 ? 1 : -1;
        this.peds.push({ id: 'ped' + (this.pedCounter++), cr, dir, x: dir > 0 ? 0 : cr.width, state: 'wait', since: this.t, speed: Math.max(0.7, this.rand.normal(1.25, 0.2)), off: (this.rand() - 0.5) * cr.half * 1.4 });
      }
      cr.waiting = this.peds.filter(p => p.cr === cr && p.state === 'wait').length;
      // pelican signal cycle (vehicle green -> yellow -> pedestrian walk -> clearance)
      if (cr.type === 'pelican') {
        const el = this.t - cr.phaseStart, d = cr.d;
        if (cr.phase === 'veh' && el >= (+d.minVehGreen || 25) && cr.waiting > 0) { cr.phase = 'vy'; cr.phaseStart = this.t; }
        else if (cr.phase === 'vy' && el >= 3) { cr.phase = 'ped'; cr.phaseStart = this.t; }
        else if (cr.phase === 'ped' && el >= (+d.walk || 10)) { cr.phase = 'clr'; cr.phaseStart = this.t; }
        else if (cr.phase === 'clr' && el >= (+d.clearance || Math.ceil(cr.width / 1.2))) { cr.phase = 'veh'; cr.phaseStart = this.t; }
      }
      if (cr.type === 'tls') {
        // walk when every vehicle link leaving the crossed approach is red
        const outs = cr.parts.filter(p => !p.rev).flatMap(p => p.lane.out);
        cr.walkOk = outs.length > 0 && outs.every(c => { const s = this.linkState(c); return s === 'r' || s === null; });
      }
      // forget yield decisions of vehicles that passed
      if (cr.yields.size > 200) cr.yields.clear();
    }
    const done = [];
    for (const p of this.peds) {
      const cr = p.cr;
      if (p.state === 'wait') {
        let go = false;
        if (cr.type === 'pelican') go = cr.phase === 'ped';
        else if (cr.type === 'tls') go = !!cr.walkOk;
        else {
          // zebra: accept a gap when no vehicle reaches the crossing soon (shorter accepted gap after long waits)
          const waited = this.t - p.since, need = waited > 40 ? 1.8 : waited > 15 ? 2.8 : 4;
          go = cr.parts.every(pt => {
            for (const v of pt.lane.vehs) {
              const d = pt.s - cr.half - v.pos;
              if (v.pos >= pt.s - cr.half - 0.5 && v.pos - v.vt.length <= pt.s + cr.half) return false; // on the crossing
              if (d > 0 && v.v > 0.5 && d / v.v < need) return false;
            }
            for (const c of pt.lane.edge ? [] : []) void c;
            return true;
          });
        }
        if (go) { p.state = 'walk'; const w = this.t - p.since; this.pedStats.waitSum += w; cr.waitSum += w; this.pedStats.maxWait = Math.max(this.pedStats.maxWait, w); }
        continue;
      }
      // walking: stop briefly if a vehicle is still on the part right in front (no collision)
      p.x += p.dir * p.speed * dt;
      if ((p.dir > 0 && p.x >= cr.width) || (p.dir < 0 && p.x <= 0)) done.push(p);
    }
    if (done.length) {
      this.peds = this.peds.filter(p => !done.includes(p));
      for (const p of done) { p.cr.crossed++; this.pedStats.crossed++; }
    }
    if (this.peds.length > 3000) this.peds.splice(0, this.peds.length - 3000);
  }
  pedPose(p) {
    const cr = p.cr, a = cr.ang + Math.PI / 2; // across the road, from right to left side
    const sideStart = -cr.width / 2 + (cr.te.spreadRight ? 0 : 0);
    const off = sideStart + p.x;
    return { x: cr.P.x + Math.cos(a) * off + Math.cos(cr.ang) * p.off, y: cr.P.y + Math.sin(a) * off + Math.sin(cr.ang) * p.off };
  }

  /* ----- lane changing ----- */
  laneChange(veh) {
    if (veh.kind !== 'lane') return;
    const L = veh.seg, te = L.edge, n = te.lanes.length;
    if (n < 2) return;
    const vt = veh.vt;
    if (veh.pos < vt.length + 0.5) return;
    const dEnd = L.length - veh.pos;
    if (veh.forcedLane && veh.forcedLane.until > this.t) {
      const tgt = Math.min(n - 1, veh.forcedLane.lane);
      if (tgt !== L.index) this.tryChange(veh, L.index + Math.sign(tgt - L.index), 0.6);
      return;
    }
    let allowed = this.bestLanes(te.id, veh.route[veh.ri + 1]);
    const st0 = veh.stops && veh.stops[0];
    if (st0 && st0.edge === te.id && veh.pos < st0.endPos) allowed = [st0.laneIndex];
    if (veh.adhoc && veh.adhoc.edge === te.id) allowed = [0];
    if (allowed.length && !allowed.includes(L.index)) {
      let nearest = allowed[0]; for (const a of allowed) if (Math.abs(a - L.index) < Math.abs(nearest - L.index)) nearest = a;
      const dir = Math.sign(nearest - L.index);
      const urg = dEnd < 30 + veh.v * 4 ? 0.35 : 1;
      if (this.tryChange(veh, L.index + dir, urg)) return;
      if (veh.v < 0.5 && dEnd < 15) this.tryChange(veh, L.index + dir, 0.05);
      return;
    }
    if (this.t - veh.lastLC < 4 + vt.lcDuration) return;
    const canUse = i => i >= 0 && i < n && (allowed.length === 0 || allowed.includes(i) || dEnd > 250);
    const expV = (lane) => {
      const ld = this.laneLeader(lane, veh, veh.pos - 0.01);
      const vmax = Math.min(vt.maxSpeed, lane.speed * veh.speedFactor);
      if (!ld) return vmax;
      const gap = ld.pos - ld.vt.length - veh.pos - vt.minGap;
      if (gap > 150) return vmax;
      return Math.min(vmax, this.krausSafe(veh.v, ld.v, gap, vt), ld.v + gap / 10);
    };
    const cur = expV(L);
    const vmax = Math.min(vt.maxSpeed, L.speed * veh.speedFactor);
    if (vt.lcSpeedGain > 0 && cur < vmax * 0.9) {
      let best = null, bestGain = 1.5 / vt.lcSpeedGain;
      for (const d of [1, -1]) {
        const i = L.index + d; if (!canUse(i)) continue;
        const g = expV(te.lanes[i]) - cur;
        if (g > bestGain) { bestGain = g; best = i; }
      }
      if (best !== null && this.tryChange(veh, best, 1)) return;
    }
    if (vt.lcKeepRight > 0 && L.index > 0 && canUse(L.index - 1) && this.t - veh.lastLC > 10 / vt.lcKeepRight) {
      const r = expV(te.lanes[L.index - 1]);
      if (r >= cur - 0.3 && r >= vmax * 0.9) this.tryChange(veh, L.index - 1, 1.3);
    }
  }
  tryChange(veh, idx, f) {
    const L = veh.seg, te = L.edge;
    if (idx < 0 || idx >= te.lanes.length) return false;
    const N = te.lanes[idx], vt = veh.vt;
    let lead = null, fol = null;
    const sub = this.isSublane(vt);
    const nlat = sub ? Math.max(this.latLimits(N, vt)[0], Math.min(this.latLimits(N, vt)[1], 0)) : 0;
    for (const o of N.vehs) {
      if (sub && !this.latOverlap(nlat, vt.width, o.lat || 0, o.vt.width)) continue;
      if (o.pos >= veh.pos) { if (!lead || o.pos < lead.pos) lead = o; }
      else if (!fol || o.pos > fol.pos) fol = o;
    }
    if (!sub) for (const o of N.vehs) { if ((o.lat || 0) !== 0 && o.pos > veh.pos - vt.length - 0.3 && o.pos - o.vt.length < veh.pos + 0.3 && this.latOverlap(0, vt.width, o.lat, o.vt.width)) return false; }
    if (lead) {
      const g = lead.pos - lead.vt.length - veh.pos;
      const hard = Math.max(0, veh.v * veh.v - lead.v * lead.v) / (2 * (lead.vt.emergencyDecel || 7)) + 0.5;
      if (g < hard || g < f * (vt.minGap + Math.max(0, veh.v - lead.v) * vt.tau + veh.v * 0.3)) return false;
    }
    // vehicles still inside the junction behind the target lane are followers too
    for (const c of (this.T.connsInto && this.T.connsInto[N.id]) || []) for (const o of c.vehs) {
      if (sub && !this.latOverlap(nlat, vt.width, o.lat || 0, o.vt.width)) continue;
      const p = -(c.length - o.pos);
      if (!fol || p > fol.pos) fol = { pos: p, v: o.v, vt: o.vt };
    }
    if (fol) {
      const g = veh.pos - vt.length - fol.pos;
      // the follower must always be able to stop behind us with its emergency deceleration
      const hard = Math.max(0, fol.v * fol.v - veh.v * veh.v) / (2 * Math.min(fol.vt.decel * 1.5, fol.vt.emergencyDecel || 7)) + fol.v * this.dt + 0.5;
      if (g < hard || g < f * (fol.vt.minGap + Math.max(0, fol.v - veh.v) * fol.vt.tau * 1.5 + fol.v * 0.5)) return false;
    }
    L.vehs.splice(L.vehs.indexOf(veh), 1);
    N.vehs.push(veh);
    veh.latOff += L.off - N.off + (veh.lat || 0) - nlat;
    veh.lat = nlat; veh.latTarget = undefined;
    veh.seg = N; veh.lastLC = this.t; veh.committed = null;
    veh.nextConn = this.connFor(veh);
    return true;
  }

  /* ----- traffic lights ----- */
  updateTLS() {
    for (const st of Object.values(this.tls)) {
      if (st.override) continue;
      if (st.prog.type === 'rl') { this.updateRL(st); continue; }
      const ph = st.prog.phases[st.phase];
      const el = this.t - st.start;
      let end = st.endOverride !== null ? st.endOverride : st.start + ph.duration;
      if (st.prog.type === 'actuated' && st.endOverride === null && /[Gg]/.test(ph.state) && ph.minDur !== undefined) {
        const minD = +ph.minDur || ph.duration, maxD = +ph.maxDur || ph.duration;
        if (el < minD) end = st.start + minD;
        else {
          const pr = this.T.tlsPrograms[st.id];
          let demand = false;
          for (const c of pr.links) {
            const ch = ph.state[c.tlIndex];
            if (ch !== 'G' && ch !== 'g') continue;
            for (const ap of c.approaching) if (ap.dEnd < Math.max(25, ap.veh.v * 3) && ap.veh.v > 0.3) { demand = true; break; }
            if (demand) break;
          }
          end = demand && el < maxD ? this.t + this.dt : this.t;
          if (el >= maxD) end = this.t;
        }
      }
      if (this.t >= end - 1e-6) {
        st.phase = (st.phase + 1) % st.prog.phases.length; st.start = this.t; st.endOverride = null;
      }
    }
  }

  /* ----- reinforcement-learning signal control (tabular Q-learning) -----
     state  = (current green phase, queue level on each green phase's lanes)
     action = 0 keep green / 1 end green (go to the following yellow)
     reward = -(mean number of halting vehicles on the program's approaches) */
  rlInfo(st) {
    if (st.rlInfo) return st.rlInfo;
    const pr = this.T.tlsPrograms[st.id], phases = st.prog.phases;
    const greens = phases.map((p, i) => /[Gg]/.test(p.state) ? i : -1).filter(i => i >= 0);
    const lanesOf = i => [...new Set(pr.links.filter(c => /[Gg]/.test(phases[i].state[c.tlIndex])).map(c => c.fromL))];
    const allLanes = [...new Set(pr.links.map(c => c.fromL))];
    return st.rlInfo = { greens, lanes: greens.map(lanesOf), allLanes };
  }
  rlState(st, info) {
    const lv = n => n === 0 ? 0 : n <= 3 ? 1 : n <= 8 ? 2 : n <= 15 ? 3 : 4;
    const q = info.lanes.map(ls => lv(ls.reduce((a, L) => a + L.vehs.filter(v => v.v < 0.1).length, 0)));
    return st.phase + ':' + q.join('');
  }
  updateRL(st) {
    const ph = st.prog.phases[st.phase], el = this.t - st.start, info = this.rlInfo(st);
    const rl = st.prog.rl = st.prog.rl || { q: {}, minGreen: 10, maxGreen: 60, interval: 5 };
    const train = this.rlTrain;
    let halt = 0; for (const L of info.allLanes) for (const v of L.vehs) if (v.v < 0.1) halt++;
    st.rlHalt = (st.rlHalt || 0) + halt; st.rlN = (st.rlN || 0) + 1;
    if (!/[Gg]/.test(ph.state)) { if (el >= ph.duration - 1e-6) { st.phase = (st.phase + 1) % st.prog.phases.length; st.start = this.t; st.nextDecision = this.t + rl.minGreen; } return; }
    if (st.nextDecision === undefined) st.nextDecision = st.start + rl.minGreen;
    if (this.t + 1e-6 < st.nextDecision && el < rl.maxGreen) return;
    const s = this.rlState(st, info);
    const Q = rl.q[s] = rl.q[s] || [0, 0];
    if (train && st.prevS !== undefined) {
      const r = -st.rlHalt / Math.max(1, st.rlN);
      const Qp = rl.q[st.prevS];
      Qp[st.prevA] += train.alpha * (r + train.gamma * Math.max(Q[0], Q[1]) - Qp[st.prevA]);
      train.rewardSum += r; train.decisions++;
    }
    st.rlHalt = 0; st.rlN = 0;
    let a = Q[1] > Q[0] ? 1 : 0;
    if (train && this.rand() < train.eps) a = this.rand() < 0.5 ? 1 : 0;
    if (el >= rl.maxGreen) a = 1;
    st.prevS = s; st.prevA = a;
    if (a === 1) { st.phase = (st.phase + 1) % st.prog.phases.length; st.start = this.t; }
    else st.nextDecision = this.t + rl.interval;
  }

  /* ----- main step ----- */
  step() {
    const dt = this.dt, T = this.T;
    this.stepDeparted = []; this.stepArrived = [];
    // departures
    while (this.pending.length && this.pending[0].depart <= this.t + 1e-6) this.waitingInsert.push(this.pending.shift());
    for (const fs of this.flowState) {
      if (!fs.edges) continue;
      if (this.t < fs.begin || this.t >= fs.end) continue;
      if (fs.prob !== null) {
        if (this.rand() < fs.prob * dt) this.spawnFlow(fs);
      } else if (fs.period) {
        while (fs.next <= this.t + 1e-6 && fs.next < fs.end && (!fs.f.number || fs.count < +fs.f.number)) { this.spawnFlow(fs); fs.next += fs.period; }
      }
    }
    const still = [];
    for (const p of this.waitingInsert) {
      if (this.vehs.has(p.id)) { this.warn('ID ganda ' + p.id); continue; }
      const r = this.tryInsert(p);
      if (r === 'wait') still.push(p); else if (r === 'drop') this.warn('Gagal menyisipkan ' + p.id);
    }
    this.waitingInsert = still;
    // approach information
    for (const c of T.conns) c.approaching = [];
    for (const veh of this.vehs.values()) if (veh.kind === 'lane') veh.nextConn = this.connFor(veh);
    // only vehicles that can actually reach the junction next count as approaching:
    // the front vehicle of a lane, and followers while everyone ahead uses the same link
    for (const L of Object.values(T.lanes)) {
      if (!L.vehs.length) continue;
      const order = L.vehs.slice().sort((a, b) => b.pos - a.pos);
      let link = undefined;
      for (const veh of order) {
        const c = veh.nextConn; if (!c) break;
        if (link !== undefined && c !== link) break;
        link = c;
        const dEnd = L.length - veh.pos;
        if (dEnd >= 120) break;
        c.approaching.push({ veh, dEnd, eta: veh.v > 0.5 ? dEnd / veh.v : Math.sqrt(2 * Math.max(0.1, dEnd) / veh.vt.accel) + 0.5 });
      }
    }
    this.updateTLS();
    this.updatePeds();
    // lane changes
    for (const veh of this.vehs.values()) this.laneChange(veh);
    for (const veh of this.vehs.values()) this.lateralMove(veh);
    // longitudinal
    const newV = new Map();
    for (const veh of this.vehs.values()) {
      const L = veh.seg;
      const laneSpeed = veh.kind === 'lane' ? L.speed : L.speed;
      let vmax = Math.min(veh.vt.maxSpeed, laneSpeed * veh.speedFactor);
      if (veh.maxSpeed !== undefined) vmax = Math.min(vmax, veh.maxSpeed);
      const obs = this.obstaclesFor(veh);
      let vn = this.nextSpeed(veh, obs, vmax);
      if (veh.forcedSpeed !== null && veh.forcedSpeed !== undefined) {
        const target = veh.forcedSpeed;
        let safe = Infinity; for (const o of obs) safe = Math.min(safe, this.safeOf(veh, o));
        vn = Math.max(0, Math.min(target, safe, veh.v + veh.vt.accel * dt));
        vn = Math.max(vn, Math.min(target, veh.v - veh.vt.decel * dt));
        vn = Math.min(vn, safe);
      }
      if (veh.slowDown) {
        const sd = veh.slowDown;
        if (this.t >= sd.end) veh.slowDown = null;
        else { const frac = (this.t - sd.start) / Math.max(dt, sd.end - sd.start); vn = Math.min(vn, sd.v0 + (sd.v - sd.v0) * frac); }
      }
      if (veh.dwell > 0) vn = 0;
      newV.set(veh, vn);
    }
    // move
    const arrivedNow = [];
    const crossings = [];
    const entered = {}; // vehicles that moved onto a segment during this step (segment lists are rebuilt afterwards)
    for (const [veh, vn] of newV) {
      const a = (vn - veh.v) / dt;
      const oldSeg = veh.seg, oldPos = veh.pos;
      veh.a = a; veh.v = vn;
      const dx = vn * dt;
      veh.pos += dx; veh.dist += dx;
      crossings.push([veh, oldSeg, oldPos]);
      // emissions
      const e = SW.emission(veh.vt, vn, a, dt, this.gradeOf(veh));
      veh.emStep = e;
      for (const k in e) { veh.em[k] += e[k]; this.totals[k] += e[k]; }
      this.totals.dist += dx;
      if (veh.vt.emissionClass === 'Energy') veh.battery = Math.max(0, Math.min(veh.vt.batteryCapacity || 35000, veh.battery - e.elec));
      // waiting
      if (vn < 0.1) { veh.wait += dt; veh.waitTotal += dt; } else veh.wait = 0;
      const vmaxIdeal = Math.min(veh.vt.maxSpeed, veh.seg.speed * veh.speedFactor);
      veh.timeLoss += dt * Math.max(0, 1 - vn / Math.max(0.1, vmaxIdeal));
      // lateral animation
      if (veh.latOff) { const s = SW.LANE_W / Math.max(0.3, veh.vt.lcDuration) * dt; veh.latOff = Math.abs(veh.latOff) <= s ? 0 : veh.latOff - Math.sign(veh.latOff) * s; }
      // segment transitions
      let guard = 0;
      while (veh.pos > veh.seg.length && guard++ < 10) {
        const over = veh.pos - veh.seg.length;
        if (veh.kind === 'lane') {
          if (veh.ri >= veh.route.length - 1) { arrivedNow.push(veh); break; }
          const c = veh.nextConn || this.connFor(veh);
          if (!c) { veh.pos = veh.seg.length; veh.v = 0; break; }
          if (this.entryBlocked(c, veh, over, entered)) { veh.pos = veh.seg.length - 0.001; veh.v = 0; break; }
          (entered[c.id] = entered[c.id] || []).push(veh);
          this.recordApproach(veh, veh.seg);
          veh.seg = c; veh.kind = 'conn'; veh.pos = over; veh.committed = null;
        } else {
          const c = veh.seg;
          if (this.entryBlocked(c.toL, veh, over, entered)) { veh.pos = c.length - 0.001; veh.v = 0; break; }
          (entered[c.toL.id] = entered[c.toL.id] || []).push(veh);
          veh.seg = c.toL; veh.kind = 'lane'; veh.ri++; veh.pos = over;
          veh.edgeEnter = this.t; this.countEdge(c.to, veh);
          this.edgeStats[c.to].acc.entered++;
          veh.nextConn = this.connFor(veh);
        }
      }
    }
    for (const veh of arrivedNow) this.arrive(veh, 'arrived');
    this.updateStops();
    // teleport stuck vehicles
    if (this.cfg.timeToTeleport > 0) {
      for (const veh of [...this.vehs.values()]) if (veh.wait > this.cfg.timeToTeleport) this.teleport(veh);
    }
    // rebuild segment lists
    for (const l of Object.values(T.lanes)) l.vehs = [];
    for (const c of T.conns) c.vehs = [];
    for (const veh of this.vehs.values()) veh.seg.vehs.push(veh);
    this.resolveOverlaps();
    // detectors & statistics
    this.t = Math.round((this.t + dt) * 1e6) / 1e6;
    this.updateDetectors(crossings);
    this.updateEdgeStats();
    this.updateQueues();
    this.recordSummary();
    if (this.t - this.intervalStart >= this.cfg.period - 1e-6) this.closeInterval();
    if (this.hooks.step) this.hooks.step(this);
  }
  spawnFlow(fs) {
    const id = fs.f.id + '.' + fs.count++;
    this.waitingInsert.push({ id, type: fs.f.type, edges: fs.edges, depart: this.t, departLane: fs.f.departLane || 'best', departSpeed: fs.f.departSpeed || 'max', color: fs.f.color, stops: fs.f.stops });
    this.loaded++;
  }
  arrive(veh, reason) {
    this.vehs.delete(veh.id);
    const i = veh.seg.vehs.indexOf(veh); if (i >= 0) veh.seg.vehs.splice(i, 1);
    this.arrived.push(veh.id); this.stepArrived.push(veh.id);
    this.tripinfo.push({
      id: veh.id, type: veh.typeId, depart: veh.depart, departDelay: veh.departDelay, arrival: this.t + this.dt, duration: this.t + this.dt - veh.depart,
      routeLength: veh.dist, waitingTime: veh.waitTotal, timeLoss: veh.timeLoss, vaporized: reason !== 'arrived' ? reason : '',
      CO2: veh.em.CO2, CO: veh.em.CO, HC: veh.em.HC, NOx: veh.em.NOx, PMx: veh.em.PMx, fuel: veh.em.fuel, elec: veh.em.elec,
      route: veh.route.join(' ')
    });
    if (this.tripinfo.length > 20000) this.tripinfo.shift();
  }
  teleport(veh) {
    // jump to the next edge in the route if possible
    this.teleports++;
    this.warn(`Teleport ${veh.id} (macet ${Math.round(veh.wait)} dtk)`);
    const nextIdx = veh.kind === 'lane' ? veh.ri + 1 : veh.ri + 1;
    const nextEdge = veh.route[nextIdx];
    const i = veh.seg.vehs.indexOf(veh); if (i >= 0) veh.seg.vehs.splice(i, 1);
    if (!nextEdge) { this.arrive(veh, 'teleport'); return; }
    const te = this.T.edges[nextEdge];
    for (const L of te.lanes) {
      const last = this.laneLast(L, veh);
      if (!last || last.pos - last.vt.length > veh.vt.length + veh.vt.minGap) {
        veh.seg = L; veh.kind = 'lane'; veh.ri = nextIdx; veh.pos = veh.vt.length; veh.v = 0; veh.wait = 0; veh.committed = null; veh.latOff = 0;
        L.vehs.push(veh); veh.nextConn = this.connFor(veh);
        return;
      }
    }
    veh.wait = this.cfg.timeToTeleport * 0.8; // retry later
    veh.seg.vehs.push(veh);
  }
  updateDetectors(crossings) {
    const byLane = {};
    for (const [veh, oldSeg, oldPos] of crossings) {
      if (veh.seg.edge === undefined) continue;
      (byLane[veh.seg.id] = byLane[veh.seg.id] || []).push([veh, oldSeg === veh.seg ? oldPos : -1e9]);
    }
    for (const d of this.e1) {
      const pos = Math.min(d.d.pos, d.lane.length - 0.1);
      const list = byLane[d.lane.id] || [];
      let n = 0, sp = 0, occ = false; const ids = [];
      for (const [veh, op] of list) {
        if (op < pos && veh.pos >= pos) { n++; sp += veh.v; ids.push(veh.id); d.acc.lenSum += veh.vt.length; }
        if (veh.pos >= pos && veh.pos - veh.vt.length <= pos) { occ = true; if (!ids.includes(veh.id)) ids.push(veh.id); }
      }
      d.last = { n, speed: n ? sp / n : -1, occ: occ ? 100 : 0, ids };
      if (n || occ) d.lastDetect = this.t;
      d.acc.n += n; d.acc.speedSum += sp; if (occ) d.acc.occTime += this.dt;
    }
    for (const d of this.e2) {
      const s0 = d.d.pos, s1 = Math.min(d.lane.length, d.d.pos + d.d.length);
      let n = 0, sp = 0, cover = 0, jamM = 0, jamV = 0, halting = 0; const ids = [];
      for (const veh of d.lane.vehs) {
        const front = veh.pos, rear = veh.pos - veh.vt.length;
        if (front < s0 || rear > s1) continue;
        n++; sp += veh.v; ids.push(veh.id);
        cover += Math.min(front, s1) - Math.max(rear, s0);
        if (veh.v < 1.39) { halting++; jamV++; jamM += veh.vt.length + veh.vt.minGap; }
      }
      d.last = { n, speed: n ? sp / n : -1, occ: 100 * cover / Math.max(0.1, s1 - s0), jamM: Math.min(jamM, s1 - s0), jamV, halting, ids };
      const a = d.acc; a.steps++; a.nSum += n; if (n) { a.speedSum += sp; a.speedN += n; } a.occSum += d.last.occ; a.maxJam = Math.max(a.maxJam, d.last.jamM); a.jamSum += d.last.jamM;
    }
  }
  updateEdgeStats() {
    for (const [id, st] of Object.entries(this.edgeStats)) {
      const te = this.T.edges[id];
      let n = 0, sp = 0, h = 0, co2 = 0; const ids = [];
      for (const L of te.lanes) for (const veh of L.vehs) { n++; sp += veh.v; ids.push(veh.id); if (veh.v < 0.1) h++; co2 += veh.emStep.CO2; st.acc.wait += veh.v < 0.1 ? this.dt : 0; }
      st.n = n; st.speed = n ? sp / n : -1; st.halting = h; st.co2 = co2 / this.dt; st.ids = ids;
      st.acc.sampled += n * this.dt; st.acc.speedSum += sp * this.dt; st.acc.co2 += co2;
    }
  }
  recordSummary() {
    let sp = 0, halting = 0, n = 0;
    for (const v of this.vehs.values()) { sp += v.v; n++; if (v.v < 0.1) halting++; }
    const rec = { t: this.t, running: n, halting, meanSpeed: n ? sp / n : 0, departed: this.departed, arrived: this.arrived.length, waiting: this.waitingInsert.length, co2: this.totals.CO2 };
    this.lastSummary = rec;
    const last = this.summary[this.summary.length - 1];
    if (!last || this.t - last.t >= Math.max(1, this.dt) - 1e-6) { this.summary.push(rec); if (this.summary.length > 20000) this.summary.shift(); }
  }
  closeInterval() {
    const P = this.t - this.intervalStart, b = this.intervalStart, e = this.t;
    for (const d of this.e1) {
      const a = d.acc;
      d.intervals.push({ begin: b, end: e, nVehContrib: a.n, flow: a.n * 3600 / P, occupancy: 100 * a.occTime / P, speed: a.n ? a.speedSum / a.n : -1, length: a.n ? a.lenSum / a.n : -1 });
      d.lastIntervalN = a.n; d.acc = this.newE1Acc();
    }
    for (const d of this.e2) {
      const a = d.acc;
      d.intervals.push({ begin: b, end: e, meanVehicleNumber: a.steps ? a.nSum / a.steps : 0, meanSpeed: a.speedN ? a.speedSum / a.speedN : -1, meanOccupancy: a.steps ? a.occSum / a.steps : 0, maxJamLengthInMeters: a.maxJam, meanJamLengthInMeters: a.steps ? a.jamSum / a.steps : 0 });
      d.acc = this.newE2Acc();
    }
    for (const [id, st] of Object.entries(this.edgeStats)) {
      const a = st.acc, len = this.T.edges[id].length;
      if (a.sampled > 0 || a.entered > 0) st.intervals.push({ begin: b, end: e, sampledSeconds: a.sampled, speed: a.sampled ? a.speedSum / a.sampled : -1, density: a.sampled / P / Math.max(0.001, len / 1000), entered: a.entered, waitingTime: a.wait, CO2_abs: a.co2 });
      if (st.intervals.length > 500) st.intervals.shift();
      st.acc = { sampled: 0, speedSum: 0, entered: 0, co2: 0, wait: 0 };
    }
    this.intervalStart = this.t;
  }
  minExpected() {
    let fl = 0;
    for (const fs of this.flowState) if (fs.edges && fs.end > this.t && (fs.period || fs.prob)) fl++;
    return this.vehs.size + this.pending.length + this.waitingInsert.length + fl;
  }
  /* world position of a vehicle front */
  vehLayer(veh) { return veh.kind === 'lane' ? (veh.seg.layer || 0) : 0; }
  vehZ(veh) { return veh.kind === 'lane' && veh.seg.elev ? SW.zAt(veh.seg.elev, veh.pos) : 0; }
  vehPose(veh) {
    const s = veh.seg;
    const p = SW.geom.posAt(s.shape, s.cum, veh.pos);
    const lo = (veh.latOff || 0) + (veh.lat || 0);
    if (lo) { p.x += -Math.sin(p.a) * lo; p.y += Math.cos(p.a) * lo; }
    return p;
  }
}
SW.Sim = Sim;
