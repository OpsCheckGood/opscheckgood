/**
 * The reference implementation, lifted verbatim from the PDF.
 *
 * This is the document-level JavaScript out of USAF_PFRA_Scoring.pdf -- the
 * maintainer's own fillable calculator -- decrypted and extracted by script,
 * not retyped. It is the oracle the port in src/lib/pt/score.ts is checked
 * against, so it must stay byte-for-byte what the PDF runs. Do not tidy it, do
 * not fix its style, and do not let a lint rule near it. If the PDF changes,
 * re-extract.
 *
 * Everything below the marker is the harness: enough of the Acrobat form API
 * for the script to run under Node against a plain object of field values.
 */

/* eslint-disable */
// prettier-ignore
var PF = {
  PUSHUP: [[67, 50, 63, 47, 60, 44, 56, 42, 52, 39, 49, 36, 45, 34, 42, 31, 38, 28], [66, 49, 62, 46, 59, 42, 55, 41, 51, 38, 47, 35, 44, 33, 41, 30, 37, 27], [64, 47, 60, 44, 57, 41, 53, 40, 50, 37, 46, 34, 43, 32, 40, 29, 36, 26], [63, 46, 59, 43, 56, 40, 52, 38, 49, 36, 45, 33, 42, 31, 39, 28, 35, 25], [61, 44, 57, 42, 55, 39, 51, 37, 48, 35, 44, 32, 41, 30, 38, 27, 34, 24], [60, 43, 56, 40, 53, 37, 49, 36, 46, 33, 43, 30, 39, 29, 36, 26, 33, 23], [58, 42, 55, 39, 52, 36, 48, 35, 45, 32, 42, 29, 38, 28, 35, 25, 32, 22], [57, 40, 53, 38, 51, 35, 47, 33, 44, 31, 40, 28, 37, 26, 34, 24, 31, 21], [55, 39, 52, 36, 49, 34, 45, 32, 42, 30, 39, 27, 36, 25, 33, 23, 30, 20], [54, 37, 50, 35, 48, 32, 44, 31, 41, 29, 38, 26, 35, 24, 32, 22, 29, 19], [52, 36, 49, 34, 47, 31, 43, 30, 40, 27, 37, 25, 34, 23, 31, 21, 28, 18], [51, 35, 48, 32, 45, 30, 41, 28, 39, 26, 36, 24, 33, 22, 30, 20, 27, 17], [49, 33, 46, 31, 44, 29, 40, 27, 37, 25, 35, 23, 32, 21, 29, 19, 26, 16], [48, 32, 45, 30, 43, 27, 39, 26, 36, 24, 33, 21, 30, 20, 27, 17, 24, 15], [46, 30, 43, 29, 41, 26, 38, 25, 35, 23, 32, 20, 29, 19, 26, 16, 23, 14], [45, 29, 42, 27, 40, 25, 36, 23, 33, 21, 31, 19, 28, 18, 25, 15, 22, 13], [43, 28, 41, 26, 39, 24, 35, 22, 32, 20, 30, 18, 27, 17, 24, 14, 21, 12], [42, 26, 39, 25, 37, 22, 34, 21, 31, 19, 29, 17, 26, 16, 23, 13, 20, 11], [40, 25, 38, 23, 36, 21, 32, 20, 30, 18, 28, 16, 25, 15, 22, 12, 19, 10], [39, 23, 36, 22, 35, 20, 31, 18, 28, 17, 26, 15, 24, 13, 21, 11, 18, 9], [37, 22, 35, 21, 33, 19, 30, 17, 27, 15, 25, 14, 23, 12, 20, 10, 17, 8], [36, 21, 34, 19, 32, 17, 28, 16, 26, 14, 24, 12, 21, 11, 18, 9, 16, 7], [34, 19, 32, 18, 31, 16, 27, 15, 24, 13, 23, 11, 20, 10, 17, 8, 15, 6], [33, 18, 31, 17, 29, 15, 26, 13, 23, 12, 22, 10, 19, 9, 16, 7, 14, 5], [31, 16, 29, 15, 26, 14, 24, 12, 22, 11, 21, 9, 18, 8, 15, 6, 13, 4], [30, 15, 28, 14, 26, 12, 23, 11, 21, 10, 19, 8, 17, 7, 14, 5, 12, 3]],
  HRPU: [[52, 42, 50, 40, 48, 38, 46, 36, 44, 34, 42, 32, 40, 30, 38, 28, 36, 26], [51, 41, 49, 39, 47, 37, 45, 35, 43, 33, 41, 31, 39, 29, 37, 27, 35, 25], [50, 40, 48, 38, 46, 36, 44, 34, 42, 32, 40, 30, 38, 28, 36, 26, 34, 24], [49, 39, 47, 37, 45, 35, 43, 33, 41, 31, 39, 29, 37, 27, 35, 25, 33, 23], [48, 38, 46, 36, 44, 34, 42, 32, 40, 30, 38, 28, 36, 26, 34, 24, 32, 22], [47, 37, 45, 35, 43, 33, 41, 31, 39, 29, 37, 27, 35, 25, 33, 23, 31, 21], [46, 36, 44, 34, 42, 32, 40, 30, 38, 28, 36, 26, 34, 24, 32, 22, 30, 20], [45, 35, 43, 33, 41, 31, 39, 29, 37, 27, 35, 25, 33, 23, 31, 21, 29, 19], [44, 34, 42, 32, 40, 30, 38, 28, 36, 26, 34, 24, 32, 22, 30, 20, 28, 18], [43, 33, 41, 31, 39, 29, 37, 27, 35, 25, 33, 23, 31, 21, 29, 19, 27, 17], [42, 32, 40, 30, 38, 28, 36, 26, 34, 24, 32, 22, 30, 20, 28, 18, 26, 16], [41, 31, 39, 29, 37, 27, 35, 25, 33, 23, 31, 21, 29, 19, 27, 17, 25, 15], [40, 30, 38, 28, 36, 26, 34, 24, 32, 22, 30, 20, 28, 18, 26, 16, 24, 14], [39, 29, 37, 27, 35, 25, 33, 23, 31, 21, 29, 19, 27, 17, 25, 15, 23, 13], [38, 28, 36, 26, 34, 24, 32, 22, 30, 20, 28, 18, 26, 16, 24, 14, 22, 12], [37, 27, 35, 25, 33, 23, 31, 21, 29, 19, 27, 17, 25, 15, 23, 13, 21, 11], [36, 26, 34, 24, 32, 22, 30, 20, 28, 18, 26, 16, 24, 14, 22, 12, 20, 10], [35, 25, 33, 23, 31, 21, 29, 19, 27, 17, 25, 15, 23, 13, 21, 11, 19, 9], [34, 24, 32, 22, 30, 20, 28, 18, 26, 16, 24, 14, 22, 12, 20, 10, 18, 8], [33, 23, 31, 21, 29, 19, 27, 17, 25, 15, 23, 13, 21, 11, 19, 9, 17, 7], [32, 22, 30, 20, 28, 18, 26, 16, 24, 14, 22, 12, 20, 10, 18, 8, 16, 6], [31, 21, 29, 19, 27, 17, 25, 15, 23, 13, 21, 11, 19, 9, 17, 7, 15, 5], [30, 20, 28, 18, 26, 16, 24, 14, 22, 12, 20, 10, 18, 8, 16, 6, 14, 4], [29, 19, 27, 17, 25, 15, 23, 13, 21, 11, 19, 9, 17, 7, 15, 5, 13, 3], [28, 18, 26, 16, 24, 14, 22, 12, 20, 10, 18, 8, 16, 6, 14, 4, 12, 2], [27, 17, 25, 15, 23, 13, 21, 11, 19, 9, 17, 7, 15, 5, 13, 3, 11, 1]],
  SITUP: [[58, 54, 56, 50, 54, 45, 52, 43, 50, 41, 48, 35, 46, 34, 44, 32, 42, 31], [57, 53, 55, 49, 53, 44, 51, 42, 49, 40, 47, 34, 45, 33, 43, 31, 41, 30], [56, 52, 54, 48, 52, 43, 50, 41, 48, 39, 46, 33, 44, 32, 42, 30, 40, 29], [55, 51, 53, 47, 51, 42, 49, 40, 47, 38, 45, 32, 43, 31, 41, 29, 39, 28], [54, 50, 52, 46, 50, 41, 48, 39, 46, 37, 44, 31, 42, 30, 40, 28, 38, 27], [53, 49, 51, 45, 49, 40, 47, 38, 45, 36, 43, 30, 41, 29, 39, 27, 37, 26], [52, 48, 50, 44, 48, 39, 46, 37, 44, 35, 42, 29, 40, 28, 38, 26, 36, 25], [51, 47, 49, 43, 47, 38, 45, 36, 43, 34, 41, 28, 39, 27, 37, 25, 35, 24], [50, 46, 48, 42, 46, 37, 44, 35, 42, 33, 40, 27, 38, 26, 36, 24, 34, 23], [49, 45, 47, 41, 45, 36, 43, 34, 41, 32, 39, 26, 37, 25, 35, 23, 33, 22], [48, 44, 46, 40, 44, 35, 42, 33, 40, 31, 38, 25, 36, 24, 34, 22, 32, 21], [47, 43, 45, 39, 43, 34, 41, 32, 39, 30, 37, 24, 35, 23, 33, 21, 31, 20], [46, 42, 44, 38, 42, 33, 40, 31, 38, 29, 36, 23, 34, 22, 32, 20, 30, 19], [45, 41, 43, 37, 41, 32, 39, 30, 37, 28, 35, 22, 33, 21, 31, 19, 29, 18], [44, 40, 42, 36, 40, 31, 38, 29, 36, 27, 34, 21, 32, 20, 30, 18, 28, 17], [43, 39, 41, 35, 39, 30, 37, 28, 35, 26, 33, 20, 31, 19, 29, 17, 27, 16], [42, 38, 40, 34, 38, 29, 36, 27, 34, 25, 32, 19, 30, 18, 28, 16, 26, 15], [41, 37, 39, 33, 37, 28, 35, 26, 33, 24, 31, 18, 29, 17, 27, 15, 25, 14], [40, 36, 38, 32, 36, 27, 34, 25, 32, 23, 30, 17, 28, 16, 26, 14, 24, 13], [39, 35, 37, 31, 35, 26, 33, 24, 31, 22, 29, 16, 27, 15, 25, 13, 23, 12], [38, 34, 36, 30, 34, 25, 32, 23, 30, 21, 28, 15, 26, 14, 24, 12, 22, 11], [37, 33, 35, 29, 33, 24, 31, 22, 29, 20, 27, 14, 25, 13, 23, 11, 21, 10], [36, 32, 34, 28, 32, 23, 30, 21, 28, 19, 26, 13, 24, 12, 22, 10, 20, 9], [35, 31, 33, 27, 31, 22, 29, 20, 27, 18, 25, 12, 23, 11, 21, 9, 19, 8], [34, 30, 32, 26, 30, 21, 28, 19, 26, 17, 24, 11, 22, 10, 20, 8, 18, 7], [33, 29, 31, 25, 29, 20, 27, 18, 25, 16, 23, 10, 21, 9, 19, 7, 17, 6]],
  CRUNCH: [[60, 58, 58, 56, 56, 54, 54, 52, 52, 50, 50, 48, 48, 46, 46, 44, 44, 42], [59, 57, 57, 55, 55, 53, 53, 51, 51, 49, 49, 47, 47, 45, 45, 43, 43, 41], [58, 56, 56, 54, 54, 52, 52, 50, 50, 48, 48, 46, 46, 44, 44, 42, 42, 40], [57, 55, 55, 53, 53, 51, 51, 49, 49, 47, 47, 45, 45, 43, 43, 41, 41, 39], [56, 54, 54, 52, 52, 50, 50, 48, 48, 46, 46, 44, 44, 42, 42, 40, 40, 38], [55, 53, 53, 51, 51, 49, 49, 47, 47, 45, 45, 43, 43, 41, 41, 39, 39, 37], [54, 52, 52, 50, 50, 48, 48, 46, 46, 44, 44, 42, 42, 40, 40, 38, 38, 36], [53, 51, 51, 49, 49, 47, 47, 45, 45, 43, 43, 41, 41, 39, 39, 37, 37, 35], [52, 50, 50, 48, 48, 46, 46, 44, 44, 42, 42, 40, 40, 38, 38, 36, 36, 34], [51, 49, 49, 47, 47, 45, 45, 43, 43, 41, 41, 39, 39, 37, 37, 35, 35, 33], [50, 48, 48, 46, 46, 44, 44, 42, 42, 40, 40, 38, 38, 36, 36, 34, 34, 32], [49, 47, 47, 45, 45, 43, 43, 41, 41, 39, 39, 37, 37, 35, 35, 33, 33, 31], [48, 46, 46, 44, 44, 42, 42, 40, 40, 38, 38, 36, 36, 34, 34, 32, 32, 30], [47, 45, 45, 43, 43, 41, 41, 39, 39, 37, 37, 35, 35, 33, 33, 31, 31, 29], [46, 44, 44, 42, 42, 40, 40, 38, 38, 36, 36, 34, 34, 32, 32, 30, 30, 28], [45, 43, 43, 41, 41, 39, 39, 37, 37, 35, 35, 33, 33, 31, 31, 29, 29, 27], [44, 42, 42, 40, 40, 38, 38, 36, 36, 34, 34, 32, 32, 30, 30, 28, 28, 26], [43, 41, 41, 39, 39, 37, 37, 35, 35, 33, 33, 31, 31, 29, 29, 27, 27, 25], [42, 40, 40, 38, 38, 36, 36, 34, 34, 32, 32, 30, 30, 28, 28, 26, 26, 24], [41, 39, 39, 37, 37, 35, 35, 33, 33, 31, 31, 29, 29, 27, 27, 25, 25, 23], [40, 38, 38, 36, 36, 34, 34, 32, 32, 30, 30, 28, 28, 26, 26, 24, 24, 22], [39, 37, 37, 35, 35, 33, 33, 31, 31, 29, 29, 27, 27, 25, 25, 23, 23, 21], [38, 36, 36, 34, 34, 32, 32, 30, 30, 28, 28, 26, 26, 24, 24, 22, 22, 20], [37, 35, 35, 33, 33, 31, 31, 29, 29, 27, 27, 25, 25, 23, 23, 21, 21, 19], [36, 34, 34, 32, 32, 30, 30, 28, 28, 26, 26, 24, 24, 22, 22, 20, 20, 18], [35, 33, 33, 31, 31, 29, 29, 27, 27, 25, 25, 23, 23, 21, 21, 19, 19, 17]],
  PLANK: [[220, 215, 215, 210, 210, 205, 205, 200, 200, 195, 195, 190, 190, 185, 185, 180, 180, 175], [215, 210, 210, 205, 205, 200, 200, 195, 195, 190, 190, 185, 185, 180, 180, 175, 175, 170], [210, 205, 205, 200, 200, 195, 195, 190, 190, 185, 185, 180, 180, 175, 175, 170, 170, 165], [205, 200, 200, 195, 195, 190, 190, 185, 185, 180, 180, 175, 175, 170, 170, 165, 165, 160], [200, 195, 195, 190, 190, 185, 185, 180, 180, 175, 175, 170, 170, 165, 165, 160, 160, 155], [195, 190, 190, 185, 185, 180, 180, 175, 175, 170, 170, 165, 165, 160, 160, 155, 155, 150], [190, 185, 185, 180, 180, 175, 175, 170, 170, 165, 165, 160, 160, 155, 155, 150, 150, 145], [185, 180, 180, 175, 175, 170, 170, 165, 165, 160, 160, 155, 155, 150, 150, 145, 145, 140], [180, 175, 175, 170, 170, 165, 165, 160, 160, 155, 155, 150, 150, 145, 145, 140, 140, 135], [175, 170, 170, 165, 165, 160, 160, 155, 155, 150, 150, 145, 145, 140, 140, 135, 135, 130], [170, 165, 165, 160, 160, 155, 155, 150, 150, 145, 145, 140, 140, 135, 135, 130, 130, 125], [165, 160, 160, 155, 155, 150, 150, 145, 145, 140, 140, 135, 135, 130, 130, 125, 125, 120], [160, 155, 155, 150, 150, 145, 145, 140, 140, 135, 135, 130, 130, 125, 125, 120, 120, 115], [155, 150, 150, 145, 145, 140, 140, 135, 135, 130, 130, 125, 125, 120, 120, 115, 115, 110], [150, 145, 145, 140, 140, 135, 135, 130, 130, 125, 125, 120, 120, 115, 115, 110, 110, 105], [145, 140, 140, 135, 135, 130, 130, 125, 125, 120, 120, 115, 115, 110, 110, 105, 105, 100], [140, 135, 135, 130, 130, 125, 125, 120, 120, 115, 115, 110, 110, 105, 105, 100, 100, 95], [135, 130, 130, 125, 125, 120, 120, 115, 115, 110, 110, 105, 105, 100, 100, 95, 95, 90], [130, 125, 125, 120, 120, 115, 115, 110, 110, 105, 105, 100, 100, 95, 95, 90, 90, 85], [125, 120, 120, 115, 115, 110, 110, 105, 105, 100, 100, 95, 95, 90, 90, 85, 85, 80], [120, 115, 115, 110, 110, 105, 105, 100, 100, 95, 95, 90, 90, 85, 85, 80, 80, 75], [115, 110, 110, 105, 105, 100, 100, 95, 95, 90, 90, 85, 85, 80, 80, 75, 75, 70], [110, 105, 105, 100, 100, 95, 95, 90, 90, 85, 85, 80, 80, 75, 75, 70, 70, 65], [105, 100, 100, 95, 95, 90, 90, 85, 85, 80, 80, 75, 75, 70, 70, 65, 65, 60], [100, 95, 95, 90, 90, 85, 85, 80, 80, 75, 75, 70, 70, 65, 65, 60, 60, 55], [95, 90, 90, 85, 85, 80, 80, 75, 75, 70, 70, 65, 65, 60, 60, 55, 55, 50]],
  RUN: [[805, 930, 815, 955, 822, 970, 836, 972, 845, 1005, 870, 1015, 909, 1030, 928, 1063, 1018, 1100], [824, 960, 834, 984, 843, 1000, 858, 1003, 869, 1035, 894, 1046, 932, 1063, 952, 1096, 1039, 1134], [843, 989, 853, 1014, 864, 1031, 880, 1034, 893, 1066, 918, 1077, 955, 1096, 977, 1129, 1060, 1168], [862, 1019, 872, 1043, 885, 1061, 902, 1065, 917, 1096, 942, 1108, 978, 1128, 1001, 1162, 1081, 1202], [881, 1049, 891, 1072, 906, 1091, 924, 1096, 941, 1126, 965, 1139, 1001, 1161, 1026, 1194, 1102, 1236], [900, 1078, 910, 1101, 928, 1121, 946, 1127, 965, 1157, 989, 1170, 1024, 1194, 1050, 1227, 1124, 1270], [919, 1108, 929, 1131, 949, 1152, 968, 1157, 989, 1187, 1013, 1201, 1047, 1227, 1074, 1260, 1145, 1304], [938, 1138, 948, 1160, 970, 1182, 990, 1188, 1013, 1217, 1037, 1232, 1070, 1259, 1099, 1293, 1166, 1338], [957, 1167, 967, 1189, 991, 1212, 1012, 1219, 1037, 1248, 1061, 1263, 1093, 1292, 1123, 1326, 1187, 1372], [976, 1197, 986, 1218, 1012, 1242, 1034, 1250, 1061, 1278, 1085, 1294, 1116, 1325, 1148, 1359, 1208, 1406], [995, 1227, 1005, 1248, 1033, 1273, 1056, 1281, 1085, 1309, 1109, 1325, 1140, 1358, 1172, 1392, 1229, 1440], [1014, 1256, 1024, 1277, 1054, 1303, 1078, 1312, 1108, 1339, 1132, 1356, 1163, 1390, 1196, 1424, 1250, 1474], [1033, 1286, 1043, 1306, 1075, 1333, 1100, 1343, 1132, 1369, 1156, 1387, 1186, 1423, 1221, 1457, 1271, 1508], [1052, 1315, 1062, 1335, 1096, 1363, 1122, 1374, 1156, 1400, 1180, 1418, 1209, 1456, 1245, 1490, 1292, 1542], [1071, 1345, 1081, 1365, 1117, 1394, 1144, 1405, 1180, 1430, 1204, 1449, 1232, 1489, 1270, 1523, 1313, 1576], [1090, 1375, 1100, 1394, 1139, 1424, 1166, 1436, 1204, 1460, 1228, 1480, 1255, 1521, 1294, 1556, 1335, 1610], [1109, 1404, 1119, 1423, 1160, 1454, 1188, 1466, 1228, 1491, 1252, 1511, 1278, 1554, 1318, 1589, 1347, 1644], [1128, 1434, 1138, 1452, 1181, 1484, 1210, 1497, 1252, 1521, 1275, 1542, 1301, 1587, 1343, 1621, 1356, 1678], [1147, 1464, 1157, 1482, 1202, 1515, 1232, 1528, 1276, 1551, 1299, 1573, 1324, 1620, 1367, 1654, 1398, 1712], [1176, 1493, 1176, 1511, 1223, 1545, 1254, 1559, 1300, 1582, 1323, 1604, 1347, 1652, 1392, 1687, 1419, 1746], [1185, 1523, 1195, 1540, 1244, 1575, 1276, 1590, 1324, 1612, 1347, 1635, 1370, 1685, 1416, 1720, 1440, 1780]],
  HAMR: [[87, 68, 85, 65, 84, 63, 82, 63, 81, 59, 77, 58, 71, 57, 69, 53, 65, 50], [84, 65, 82, 62, 81, 60, 79, 60, 77, 56, 73, 55, 68, 53, 66, 50, 62, 47], [81, 61, 79, 58, 78, 57, 75, 56, 73, 53, 70, 52, 65, 50, 63, 47, 59, 44], [78, 58, 76, 55, 75, 53, 72, 53, 70, 50, 67, 49, 62, 47, 60, 44, 56, 41], [75, 55, 74, 52, 72, 51, 69, 50, 67, 47, 64, 46, 60, 44, 57, 42, 54, 38], [72, 52, 71, 50, 69, 48, 66, 47, 64, 45, 61, 44, 57, 42, 55, 39, 52, 36], [70, 49, 69, 47, 66, 45, 64, 45, 61, 42, 58, 41, 55, 39, 52, 37, 49, 34], [67, 46, 66, 44, 63, 43, 61, 42, 58, 40, 56, 39, 53, 37, 50, 34, 47, 32], [65, 44, 64, 42, 61, 40, 59, 40, 56, 38, 53, 37, 50, 35, 48, 32, 45, 29], [63, 41, 62, 40, 59, 38, 56, 37, 53, 35, 51, 34, 48, 32, 45, 30, 43, 27], [60, 39, 59, 38, 56, 36, 54, 35, 51, 33, 49, 32, 46, 30, 43, 28, 41, 26], [58, 37, 57, 36, 54, 34, 52, 33, 49, 31, 47, 30, 44, 28, 41, 26, 39, 24], [56, 35, 55, 34, 52, 32, 50, 31, 47, 30, 45, 29, 42, 26, 40, 25, 38, 22], [54, 33, 53, 32, 50, 30, 48, 29, 45, 28, 43, 27, 40, 25, 38, 23, 36, 20], [52, 31, 52, 30, 48, 28, 46, 28, 43, 26, 41, 25, 39, 23, 36, 21, 34, 19], [51, 29, 50, 28, 46, 26, 44, 26, 41, 24, 39, 23, 37, 21, 34, 20, 33, 18], [49, 28, 48, 26, 44, 25, 42, 24, 39, 23, 37, 22, 35, 20, 33, 18, 31, 17], [47, 26, 46, 25, 43, 23, 40, 23, 37, 21, 36, 20, 34, 18, 31, 17, 30, 14], [46, 24, 45, 23, 41, 22, 39, 21, 36, 20, 34, 19, 32, 17, 30, 15, 28, 13], [44, 23, 43, 22, 39, 20, 37, 20, 34, 19, 32, 18, 31, 16, 28, 14, 27, 12], [42, 21, 42, 20, 38, 19, 36, 18, 32, 17, 31, 16, 30, 14, 27, 13, 26, 11]],
  SW: {"PUSHUP": [67, 66, 64, 63, 61, 60, 58, 57, 55, 54, 52, 51, 49, 48, 46, 45, 43, 42, 40, 39, 37, 36, 34, 33, 31, 30], "HRPU": [52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27], "SITUP": [58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33], "CRUNCH": [60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35], "PLANK": [220, 215, 210, 205, 200, 195, 190, 185, 180, 175, 170, 165, 160, 155, 150, 145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 95], "RUN": [805, 824, 843, 862, 881, 900, 919, 938, 957, 976, 995, 1014, 1036, 1052, 1071, 1090, 1109, 1128, 1147, 1176, 1185], "HAMR": [87, 84, 81, 78, 75, 72, 70, 67, 65, 63, 60, 58, 56, 54, 52, 51, 49, 47, 46, 44, 42]},
  SP: [15.0, 14.5, 14.0, 13.5, 13.0, 12.5, 12.0, 11.5, 11.0, 10.5, 10.0, 9.5, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.5],
  CP: [50.0, 49.5, 49.0, 48.0, 47.0, 46.0, 45.0, 44.0, 43.0, 42.0, 41.0, 40.0, 39.0, 38.5, 38.0, 37.5, 37.0, 36.5, 36.0, 35.5, 35.0]
};

var WR = ["\u2264 0.49","0.50","0.51","0.52","0.53","0.54","0.55","0.56","0.57","0.58","0.59","\u2265 0.60"];
var WP = ["20.0","19.0","18.0","17.0","16.0","15.0","12.5","10.0","7.5","5.0","2.5","0.0"];
var AGEGRP = ["Under 25","25-29","30-34","35-39","40-44","45-49","50-54","55-59","60 and Over"];
var WALK_M = [976,978,983,1000,1018];
var WALK_F = [1042,1048,1069,1091,1133];

function ageIndex(a){
  if (a < 25) return 0;
  if (a < 30) return 1;
  if (a < 35) return 2;
  if (a < 40) return 3;
  if (a < 45) return 4;
  if (a < 50) return 5;
  if (a < 55) return 6;
  if (a < 60) return 7;
  return 8;
}
function walkIndex(a){
  if (a < 30) return 0;
  if (a < 40) return 1;
  if (a < 50) return 2;
  if (a < 60) return 3;
  return 4;
}
function toNum(s){
  s = String(s).replace(/[^0-9.]/g,"");
  if (s === "") return null;
  var v = parseFloat(s);
  return isNaN(v) ? null : v;
}
function toSecs(s){
  s = String(s).replace(/\s/g,"");
  if (s === "") return null;
  if (s.indexOf(":") > -1){
    var p = s.split(":");
    var m = parseInt(p[0],10), sec = parseInt(p[1],10);
    if (isNaN(m) || isNaN(sec)) return null;
    return m*60 + sec;
  }
  var v = parseFloat(s);
  return isNaN(v) ? null : v;
}
function mmss(t){
  var m = Math.floor(t/60), s = t % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}
var SWMODE = false;
/* thresholds for one event as a flat array: AFSPECWAR/EOD is a single
   age- and sex-neutral column, otherwise pull the age/sex column. */
function FL(name, col){
  if (SWMODE) return PF.SW[name];
  var t = PF[name], r = [], i;
  for (i = 0; i < t.length; i++) r.push(t[i][col]);
  return r;
}
function hiIdx(arr, val){
  for (var i=0; i<arr.length; i++){ if (val >= arr[i]) return i; }
  return -1;
}
function loIdx(arr, val){
  for (var i=0; i<arr.length; i++){ if (val <= arr[i]) return i; }
  return -1;
}

/* ---- chart row highlighting ---- */
var HL = [];
var HL_HIT = ["RGB", 1.00, 0.84, 0.30];   /* gold - the row you scored */
function clearHL(f){
  for (var i = 0; i < HL.length; i++){
    try { var g = f.getField(HL[i]); if (g) g.fillColor = color.white; } catch (e) {}
  }
  HL = [];
}
function mark(f, name, col){
  try { var g = f.getField(name); if (g){ g.fillColor = col; HL.push(name); } } catch (e) {}
}
/* light up the scored cell in the selected component's column only */
function markRow(f, key, row, col){
  if (row < 0) return;
  mark(f, "CH_" + key + "_" + row, col);
}
function pt(p){ return p.toFixed(1); }
/* every field read goes through this: a missing field must never abort the script */
function toStr(x){ return String(x); }
function FVAL(f, n){ try { var g = f.getField(n); return g ? String(g.value) : ""; } catch (e) { return ""; } }

/* AFMAN 36-2905 para 3.15.4.5: three waist measurements, the three closest
   averaged, then rounded DOWN to the nearest 1/2 inch. */
function floorHalf(x){ return Math.floor(x * 2 + 1e-9) / 2; }
function waistOf(f, notes){
  var raw = [], i, v;
  var names = ["W1","W2","W3"];
  for (i = 0; i < 3; i++){
    v = toNum(f.getField(names[i]).value);
    if (v !== null && v > 0) raw.push(v);
  }
  if (raw.length === 0) return null;
  var lo2 = raw[0], hi2 = raw[0];
  for (i = 1; i < raw.length; i++){ if (raw[i] < lo2) lo2 = raw[i]; if (raw[i] > hi2) hi2 = raw[i]; }
  if (hi2 - lo2 > 1)
    notes.push("Waist measurements differ by >1 in \u2014 take another (para 3.15.4.5).");
  if (raw.length < 3)
    notes.push("Enter three waist measurements (para 3.15.4.5).");
  var sum = 0;
  for (i = 0; i < raw.length; i++) sum += raw[i];
  return floorHalf(sum / raw.length);
}

function setDisp(f, name, vis){
  try {
    var g = f.getField(name);
    if (g) g.display = vis ? display.visible : display.hidden;
  } catch (e) {}
}
/* read a split minutes/seconds pair; returns total seconds or null */
function splitSecs(f, aName, bName){
  var m = toNum(f.getField(aName).value);
  var s = toNum(f.getField(bName).value);
  if (m === null && s === null) return null;
  return (m === null ? 0 : m) * 60 + (s === null ? 0 : s);
}

function drawChart(doc, col, blank){
  function S(n,v){ var g = doc.getField(n); if (g) g.value = v; }
  for (var w = 0; w < WR.length; w++){ S("CH_WR_" + w, WR[w]); S("CH_WP_" + w, WP[w]); }

  var maps = [["PU","PUSHUP",0],["HR","HRPU",0],["SU","SITUP",0],
              ["CR","CRUNCH",0],["PL","PLANK",1]];
  var i, j, last, v, arr;
  for (j=0; j<maps.length; j++){
    var key = maps[j][0], isTime = maps[j][2];
    arr = FL(maps[j][1], col);
    last = arr.length - 1;
    for (i=0; i<arr.length; i++){
      if (blank){ S("CH_"+key+"_"+i, ""); continue; }
      v = isTime ? mmss(arr[i]) : String(arr[i]);
      if (i === 0) v = "\u2265 " + v;
      if (i === last) v = v + "*";
      S("CH_"+key+"_"+i, v);
    }
  }
  var rr = FL("RUN", col), hh = FL("HAMR", col);
  last = rr.length - 1;
  for (i=0; i<rr.length; i++){
    if (blank){ S("CH_RUN_"+i,""); S("CH_HAMR_"+i,""); continue; }
    v = mmss(rr[i]);
    if (i === 0) v = "\u2264 " + v;
    if (i === last) v = v + "*";
    S("CH_RUN_"+i, v);
    var h = String(hh[i]);
    if (i === 0) h = "\u2265 " + h;
    if (i === last) h = h + "*";
    S("CH_HAMR_"+i, h);
  }
}


/* ---------------- Tier 2 BFA tape worksheet (page 2) ----------------
   AFMAN 36-2905 Atch 8. Neck rounds UP to the nearest 1/4 in; abdomen,
   waist and buttocks round DOWN. Male value = abdomen - neck.
   Female value = waist + buttocks - neck. The value is then matched
   against height in Atch 9 (M) / Atch 10 (F) - a table, not a formula. */
function lg(x){ return Math.log(x) / Math.LN10; }
function ceilQuarter(x){ return Math.ceil(x * 4 - 1e-9) / 4; }
function floorHalfDown(x){ return Math.floor(x * 2 + 1e-9) / 2; }
function fmtIn(x){ return (x === null) ? "" : x.toFixed(2).replace(/0$/,"").replace(/\.$/,"") + " in"; }

function bfaCalc(f, sexF){
  function S(n,v){ var g = f.getField(n); if (g) g.value = v; }

  S("BF_Sex", sexF ? "Female" : "Male");
  S("BF_Formula", sexF ? "natural waist + buttocks \u2212 neck" : "abdomen \u2212 neck");
  S("BF_Std", sexF ? "36% or less" : "26% or less");
  S("BF_Cap1", "NECK");
  S("BF_Cap2",  sexF ? "NATURAL WAIST" : "ABDOMEN");
  S("BF_Cap2R", sexF ? "WAIST \u2193" : "ABDOMEN \u2193");
  S("BF_Cap3",  sexF ? "BUTTOCKS" : "");
  S("BF_Cap3R", sexF ? "BUTTOCKS \u2193" : "");
  setDisp(f, "BF_3",     sexF);
  setDisp(f, "BF_Cap3",  sexF);
  setDisp(f, "BF_3R",    sexF);
  setDisp(f, "BF_Cap3R", sexF);
  if (!sexF){ var g3 = f.getField("BF_3"); if (g3) g3.value = ""; }

  var ht  = toNum(FVAL(f, "Height"));
  var htR = (ht === null || ht <= 0) ? null : Math.round(ht * 2) / 2;
  S("BF_Ht",  htR === null ? "" : fmtIn(htR));
  S("BF_Ht2", htR === null ? "" : fmtIn(htR));

  var neck = toNum(FVAL(f, "BF_Neck"));
  var m2   = toNum(FVAL(f, "BF_2"));
  var m3   = toNum(FVAL(f, "BF_3"));

  /* Atch 8: neck rounds UP to the nearest 1/4 in, the rest round DOWN */
  var neckR = (neck === null) ? null : ceilQuarter(neck);
  var m2R   = (m2   === null) ? null : floorHalfDown(m2);
  var m3R   = (m3   === null) ? null : floorHalfDown(m3);
  S("BF_NeckR", fmtIn(neckR));
  S("BF_2R",    fmtIn(m2R));
  S("BF_3R",    fmtIn(m3R));

  var circ = null, need = "";
  if (sexF){
    if (neckR !== null && m2R !== null && m3R !== null) circ = m2R + m3R - neckR;
    else need = "Enter neck, natural waist and buttocks.";
  } else {
    if (neckR !== null && m2R !== null) circ = m2R - neckR;
    else need = "Enter neck and abdomen.";
  }
  if (circ !== null && circ <= 0){
    need = "Check the measurements \u2014 the circumference value is not positive.";
    circ = null;
  }
  S("BF_Circ", circ === null ? "" : fmtIn(circ));

  /* DoD circumference equations; DoDI 1308.3 E3.1.2.1 - whole percent */
  var pct = null;
  if (circ !== null && htR !== null && htR > 0){
    if (sexF) pct = 163.205 * lg(circ) - 97.684 * lg(htR) - 78.387;
    else      pct = 86.010 * lg(circ) - 70.041 * lg(htR) + 36.76;
    pct = Math.round(pct);
    if (pct < 0) pct = 0;
  }
  S("BF_Pct", pct === null ? "" : pct + " %");

  var res = "", note = need;
  if (pct !== null){
    var max = sexF ? 36 : 26;
    res = (pct <= max) ? "PASS" : "FAIL";      /* Table 3.2: 26% / 36% or less */
    S("BF_Result", res);
    note = "Cross-check " + pct + "% against " + fmtIn(circ) + " and " + fmtIn(htR)
         + " in " + (sexF ? "Attachment 10." : "Attachment 9.");
  } else {
    S("BF_Result", "");
    if (htR === null) note = need + "  Enter height on page 1.";
  }
  S("BF_Notes", note);
  return { pct: pct, result: res };
}

function pfraCalc(){
  var f = this;
  function S(n,v){ var g = f.getField(n); if (g) g.value = v; }

  var age = toNum(FVAL(f, "Age"));
  var sexF = (toStr(FVAL(f, "Sex")).charAt(0) === "F");
  SWMODE = (toStr(FVAL(f, "Track")).indexOf("AFSPECWAR") > -1);
  var notes = [];

  clearHL(f);

  /* input captions + which boxes are shown, independent of age being valid */
  var exBody   = (toStr(FVAL(f, "BodyEvent")).indexOf("EXEMPT") > -1);
  var exStr    = (toStr(FVAL(f, "StrEvent")).indexOf("EXEMPT") > -1);
  var exCore   = (toStr(FVAL(f, "CoreEvent")).indexOf("EXEMPT") > -1);
  var exCardio = (toStr(FVAL(f, "CardioEvent")).indexOf("EXEMPT") > -1);

  setDisp(f, "Height", !exBody);
  setDisp(f, "W1", !exBody);
  setDisp(f, "W2", !exBody);
  setDisp(f, "W3", !exBody);
  setDisp(f, "Waist", !exBody);
  setDisp(f, "StrRaw", !exStr);
  setDisp(f, "CoreA", !exCore);
  setDisp(f, "CoreCapA", !exCore);
  setDisp(f, "CardioA", !exCardio);
  setDisp(f, "CardioCapA", !exCardio);

  var isPlank = (toStr(FVAL(f, "CoreEvent")).indexOf("Plank") > -1);
  S("CoreCapA", isPlank ? "MIN" : "REPS");
  S("CoreCapB", isPlank ? "SEC" : "");
  S("CoreColon", isPlank ? ":" : "");
  setDisp(f, "CoreB", isPlank && !exCore);
  setDisp(f, "CoreColon", isPlank && !exCore);
  setDisp(f, "CoreCapB", isPlank && !exCore);
  if (!isPlank) { var cb0 = f.getField("CoreB"); if (cb0) cb0.value = ""; }

  var isHamr = (toStr(FVAL(f, "CardioEvent")).indexOf("HAMR") > -1);
  S("CardioCapA", isHamr ? "SHUTTLES" : "MIN");
  S("CardioCapB", isHamr ? "" : "SEC");
  S("CardioColon", isHamr ? "" : ":");
  setDisp(f, "CardioB", !isHamr && !exCardio);
  setDisp(f, "CardioColon", !isHamr && !exCardio);
  setDisp(f, "CardioCapB", !isHamr && !exCardio);
  if (isHamr) { var kb0 = f.getField("CardioB"); if (kb0) kb0.value = ""; }

  if (age === null || age < 15 || age > 90){
    S("AgeGroup",""); S("WHtR",""); S("WHtRRisk",""); S("WHtRPts","");
    S("StrPts",""); S("StrMin",""); S("CorePts",""); S("CoreMin","");
    S("CardioPts",""); S("CardioMin",""); S("Composite",""); S("Rating","");
    S("WalkMax",""); S("Notes","Enter your age to load your chart.");
    S("ChartTitle", SWMODE
        ? "    YOUR SCORING CHART  \u2014  AFSPECWAR / EOD  (age and sex neutral)"
        : "    YOUR SCORING CHART \u2014 enter age and sex above");
    drawChart(f, 0, !SWMODE);
    bfaCalc(f, sexF);
    S("BFA_WHtR",""); S("BFA_PFRA",""); S("BFA_Req","Complete page 1 first"); S("BF_Effect","");
    if (SWMODE) S("Notes","AFSPECWAR/EOD standards loaded. Enter an age for the 2 km walk maximum.");
    return "";
  }
  var ai = ageIndex(age);
  var col = ai*2 + (sexF ? 1 : 0);
  S("AgeGroup", AGEGRP[ai]);
  S("ChartTitle", SWMODE
      ? "    YOUR SCORING CHART  \u2014  AFSPECWAR / EOD  (age and sex neutral)"
      : "    YOUR SCORING CHART  \u2014  " + (sexF ? "FEMALE" : "MALE") +
        ",  AGE " + AGEGRP[ai].toUpperCase());
  if (SWMODE) S("AgeGroup", "AFSPECWAR/EOD");
  drawChart(f, col, false);
  var wmax = (sexF ? WALK_F : WALK_M)[walkIndex(age)];
  S("WalkMax", "  Max time  " + mmss(wmax));

  var bfa = bfaCalc(f, sexF);

  /* body composition */
  var ht = toNum(FVAL(f, "Height"));
  var wRatio = null;
  var wa = exBody ? null : waistOf(f, notes);
  if (wa !== null) S("Waist", wa.toFixed(1)); else if (!exBody) S("Waist","");
  var wp = null;
  if (exBody){
    S("WHtR","EXEMPT"); S("WHtRRisk","Exempt \u2014 not scored"); S("WHtRPts","EXEMPT"); S("Waist","");
  } else if (ht && wa && ht > 0){
    var r = Math.floor((wa/ht)*100 + 1e-9)/100;   /* chart truncates, does not round */
    wRatio = r;
    S("WHtR", r.toFixed(2));
    if (r <= 0.49) wp = 20.0;
    else if (r >= 0.60) wp = 0.0;
    else wp = [19,18,17,16,15,12.5,10,7.5,5,2.5][Math.round(r*100) - 50];
    S("WHtRPts", pt(wp));
    var wi = (r <= 0.49) ? 0 : ((r >= 0.60) ? 11 : (Math.round(r*100) - 49));
    mark(f, "CH_WR_" + wi, HL_HIT);
    mark(f, "CH_WP_" + wi, HL_HIT);
    if (r <= 0.54) S("WHtRRisk","Low risk");
    else if (r <= 0.59) S("WHtRRisk","Moderate risk");
    else { S("WHtRRisk","HIGH RISK"); notes.push("WHtR 0.60+ = 0 points."); }
  } else { S("WHtR",""); S("WHtRRisk",""); S("WHtRPts",""); }

  /* upper body */
  var se = toStr(FVAL(f, "StrEvent"));
  if (exStr){ S("StrPts","EXEMPT"); S("StrMin","Exempt \u2014 not scored"); }
  var sarr = FL((se.indexOf("Hand") > -1) ? "HRPU" : "PUSHUP", col);
  var smin = sarr[sarr.length-1];
  if (!exStr) S("StrMin", smin + " reps");
  var skey = (se.indexOf("Hand") > -1) ? "HR" : "PU";
  var sraw = toNum(FVAL(f, "StrRaw"));
  var sp = null;
  if (exStr){ sp = "X"; }
  else if (sraw !== null){
    var si = hiIdx(sarr, sraw);
    if (si < 0){
      sp = 0; S("StrPts","0.0"); notes.push("Upper body under " + smin + " reps.");
    } else {
      sp = PF.SP[si]; S("StrPts", pt(sp));
      markRow(f, skey, si, HL_HIT);
    }
  } else S("StrPts","");

  /* core */
  var ce = toStr(FVAL(f, "CoreEvent"));
  var plank = (ce.indexOf("Plank") > -1);
  var carr = FL(plank ? "PLANK" : (ce.indexOf("Crunch") > -1 ? "CRUNCH" : "SITUP"), col);
  var cmin = carr[carr.length-1];
  if (exCore){ S("CorePts","EXEMPT"); S("CoreMin","Exempt \u2014 not scored"); }
  else S("CoreMin", plank ? mmss(cmin) : (cmin + " reps"));
  var craw = plank ? splitSecs(f, "CoreA", "CoreB") : toNum(FVAL(f, "CoreA"));
  var ckey = plank ? "PL" : (ce.indexOf("Crunch") > -1 ? "CR" : "SU");
  var cp = null;
  if (exCore){ cp = "X"; }
  else if (craw !== null){
    var ci = hiIdx(carr, craw);
    if (ci < 0){
      cp = 0; S("CorePts","0.0");
      notes.push("Core under " + (plank ? mmss(cmin) : cmin + " reps") + ".");
    } else {
      cp = PF.SP[ci]; S("CorePts", pt(cp));
      markRow(f, ckey, ci, HL_HIT);
    }
  } else S("CorePts","");

  /* cardio */
  var ke = toStr(FVAL(f, "CardioEvent"));
  var kp = null, walk = false;
  if (exCardio){
    kp = "X"; S("CardioPts","EXEMPT"); S("CardioMin","Exempt \u2014 not scored");
  } else if (ke.indexOf("Walk") > -1){
    walk = true;
    S("CardioMin", mmss(wmax) + " (pass/fail)");
    notes.push("Walk requires AF Form 469 (para 3.15.12.1).");
    var wt = splitSecs(f, "CardioA", "CardioB");
    if (wt !== null){
      if (wt <= wmax){ S("CardioPts","PASS"); kp = "X"; }
      else { S("CardioPts","FAIL"); kp = "F"; notes.push("Walk over the " + mmss(wmax) + " maximum."); }
    } else S("CardioPts","");
  } else if (ke.indexOf("HAMR") > -1){
    var harr = FL("HAMR", col); var hmin = harr[harr.length-1];
    S("CardioMin", hmin + " shuttles");
    var hraw = toNum(FVAL(f, "CardioA"));
    if (hraw !== null){
      var ki = hiIdx(harr, hraw);
      if (ki < 0){
        kp = 0; S("CardioPts","0.0"); notes.push("HAMR under " + hmin + " shuttles.");
      } else {
        kp = PF.CP[ki]; S("CardioPts", pt(kp));
        markRow(f, "HAMR", ki, HL_HIT);
      }
    } else S("CardioPts","");
  } else {
    var rarr = FL("RUN", col); var rmax = rarr[rarr.length-1];
    S("CardioMin", mmss(rmax));
    var rraw = splitSecs(f, "CardioA", "CardioB");
    if (rraw !== null){
      var ri = loIdx(rarr, rraw);
      if (ri < 0){
        kp = 0; S("CardioPts","0.0"); notes.push("Run slower than " + mmss(rmax) + ".");
      } else {
        kp = PF.CP[ri]; S("CardioPts", pt(kp));
        markRow(f, "RUN", ri, HL_HIT);
      }
    } else S("CardioPts","");
  }

  /* ---- composite, prorated over the components actually assessed ----
     AFMAN 36-2905: exempt components drop out of both the points earned and
     the points possible; the walk scores like a cardio exemption. Body
     composition has no component minimum. */
  var earned = 0, possible = 0, missing = false, compFail = false, exCount = 0;
  var bodyPts = 0, bodyPos = 0;

  if (wp === null && !exBody) missing = true;
  else if (!exBody){ bodyPts = wp; bodyPos = 20; }
  else exCount++;

  if (sp === null) missing = true;
  else if (sp === "X") exCount++;
  else { earned += sp; possible += 15; if (sp === 0) compFail = true; }

  if (cp === null) missing = true;
  else if (cp === "X") exCount++;
  else { earned += cp; possible += 15; if (cp === 0) compFail = true; }

  if (kp === null) missing = true;
  else if (kp === "X") exCount++;
  else if (kp === "F") compFail = true;
  else { earned += kp; possible += 50; if (kp === 0) compFail = true; }

  /* provisional score with body composition included */
  var provPos = possible + bodyPos;
  var prov = (provPos > 0) ? ((earned + bodyPts) / provPos) * 100 : null;
  var provUnsat = compFail || (prov !== null && prov < 75);

  /* Tier 2 BFA required when WHtR > .55 AND the PFRA is not met (para 3.1.2.1).
     Para 3.7.2: passing it scores body composition as an EXEMPT component;
     failing it makes the PFRA unsatisfactory. */
  var bfaNeeded = (!exBody && wRatio !== null && wRatio > 0.55 && provUnsat && !missing);
  if (bfaNeeded && bfa.result === "PASS"){
    bodyPts = 0; bodyPos = 0; exCount++;
    notes.push("BFA met \u2014 body composition scored as an exempt component (para 3.7.2).");
  } else if (bfaNeeded && bfa.result === "FAIL"){
    compFail = true;
    notes.push("BFA not met \u2014 unsatisfactory PFRA (para 3.7.2).");
  } else if (bfaNeeded){
    notes.push("Tier 2 BFA required (WHtR over .55 with an unsatisfactory PFRA) \u2014 see page 2.");
  }

  earned += bodyPts; possible += bodyPos;

  if (possible === 0 && !missing){
    S("Composite","\u2014"); S("Rating","NO SCORE \u2014 PFRA HOLD");
    notes.push("All components exempt \u2014 no composite.");
  } else if (missing){
    S("Composite",""); S("Rating","");
    notes.unshift("Fill every box for a composite score.");
  } else {
    var total = (earned / possible) * 100;
    S("Composite", total.toFixed(1));
    if (compFail) S("Rating","UNSAT \u2014 COMPONENT (NOT READY)");
    else if (total < 75) S("Rating","UNSATISFACTORY (NOT READY)");
    else if (walk) S("Rating","SATISFACTORY (READY)");
    else if (total < 90) S("Rating","SATISFACTORY (READY)");
    else S("Rating","EXCELLENT (READY)");
    if (possible < 100)
      notes.unshift("Scored on " + possible.toFixed(0) + " of 100 possible points ("
        + earned.toFixed(1) + "/" + possible.toFixed(0) + " \u00d7 100)."
        + ((walk && kp === "X") ? " Walk passed; cardio is not scored and Excellent is unavailable." : ""));
  }
  if (exCount > 0)
    notes.push("Exemptions normally mean PFRA Hold \u2014 confirm ALC status with your UFPM.");
  S("Notes", notes.length ? notes.join("  ") : "All assessed components meet their minimums.");

  /* page 2 readback */
  S("BFA_WHtR", (exBody || wRatio === null) ? "" : wRatio.toFixed(2));
  S("BFA_PFRA", toStr(FVAL(f, "Rating")));
  if (exBody) S("BFA_Req", "Body composition exempt");
  else if (wRatio === null || missing) S("BFA_Req", "Complete page 1 first");
  else if (bfaNeeded) S("BFA_Req", "YES \u2014 WHtR over .55 and PFRA not met");
  else if (wRatio > 0.55) S("BFA_Req", "No \u2014 high risk, but PFRA was met");
  else if (provUnsat) S("BFA_Req", "No \u2014 PFRA not met, but WHtR is not over .55");
  else S("BFA_Req", "No");

  /* page 2 is locked until page 1 says a Tier 2 BFA is required */
  setDisp(f, "BF_Neck", bfaNeeded);
  setDisp(f, "BF_2",    bfaNeeded);
  setDisp(f, "BF_3",    bfaNeeded && sexF);
  setDisp(f, "BF_Cap1", bfaNeeded);
  setDisp(f, "BF_Cap2", bfaNeeded);
  setDisp(f, "BF_Cap3", bfaNeeded && sexF);
  S("BF_Lock", bfaNeeded ? "UNLOCKED" : "LOCKED");

  if (!bfaNeeded){
    S("BF_Effect", "No Tier 2 BFA is required based on page 1.");
    S("BF_Final", ""); S("BF_FinalRating", "");
    S("BF_Neck",""); S("BF_2",""); S("BF_3","");
    S("BF_NeckR",""); S("BF_2R",""); S("BF_3R","");
    S("BF_Circ",""); S("BF_Pct",""); S("BF_Result",""); S("BF_Notes","");
  } else if (bfa.result === "PASS"){
    S("BF_Effect", "PASS \u2014 body composition scored as an exempt component; score recalculated.");
    S("BF_Final", toStr(FVAL(f, "Composite")));
    S("BF_FinalRating", toStr(FVAL(f, "Rating")));
  } else if (bfa.result === "FAIL"){
    S("BF_Effect", "FAIL \u2014 the PFRA is unsatisfactory regardless of points (para 3.7.2).");
    S("BF_Final", toStr(FVAL(f, "Composite")));
    S("BF_FinalRating", toStr(FVAL(f, "Rating")));
  } else {
    S("BF_Effect", "Tier 2 BFA REQUIRED \u2014 enter the measurements above.");
    S("BF_Final", ""); S("BF_FinalRating", "");
  }

  return "";
}

/* ------------------------------------------------------------------ *
 * Harness. Not from the PDF.
 * ------------------------------------------------------------------ */

/** Acrobat globals the script touches. Only the shapes it actually reads. */
const color = { white: ['RGB', 1, 1, 1] };
const display = { visible: 0, hidden: 1 };

/**
 * Runs the PDF's calculation over a plain object of input field values and
 * returns the field values it wrote back.
 *
 * @param {Record<string, string>} inputs field name -> value, as typed
 * @returns {Record<string, string>} every field the script set
 */
export function runReference(inputs) {
  const values = Object.create(null);
  const fields = Object.create(null);

  function field(name) {
    if (!fields[name]) {
      fields[name] = {
        get value() { return values[name] === undefined ? '' : values[name]; },
        set value(v) { values[name] = String(v); },
        fillColor: color.white,
        display: display.visible,
      };
    }
    return fields[name];
  }

  for (const key of Object.keys(inputs)) field(key).value = inputs[key];

  const doc = { getField: field };
  pfraCalc.call(doc);

  const out = Object.create(null);
  for (const key of Object.keys(values)) out[key] = values[key];
  // Which chart rows the reference highlighted, so row selection is compared too.
  out.__highlighted = HL.slice();
  return out;
}
