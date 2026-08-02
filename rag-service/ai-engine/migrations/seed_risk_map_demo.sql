-- 小盾反诈 RAG 模拟分布数据（34 个省级行政区）
-- 用途：填充 risk_map_demo_stats 表，让中国地图可视化能正常渲染
-- 字段说明：
--   simulation_version: 模拟数据集版本标识
--   province_code: 6 位行政区代码
--   province_name: 行政区名称
--   sample_count: 该地区样本案例数（模拟）
--   is_simulated: 是否为模拟数据（必须为 true，前端会有免责声明）
--   disclaimer: 数据来源免责声明

BEGIN;

INSERT INTO risk_map_demo_stats(
    simulation_version, province_code, province_name,
    sample_count, is_simulated, disclaimer
) VALUES
    ('competition_demo_v1', '110000', '北京市', 1287, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '120000', '天津市', 642, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '130000', '河北省', 1543, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '140000', '山西省', 891, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '150000', '内蒙古自治区', 723, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '210000', '辽宁省', 1198, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '220000', '吉林省', 654, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '230000', '黑龙江省', 832, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '310000', '上海市', 1456, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '320000', '江苏省', 2103, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '330000', '浙江省', 1789, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '340000', '安徽省', 1124, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '350000', '福建省', 967, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '360000', '江西省', 856, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '370000', '山东省', 1834, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '410000', '河南省', 1672, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '420000', '湖北省', 1289, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '430000', '湖南省', 1367, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '440000', '广东省', 2567, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '450000', '广西壮族自治区', 945, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '460000', '海南省', 312, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '500000', '重庆市', 1023, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '510000', '四川省', 1745, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '520000', '贵州省', 778, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '530000', '云南省', 1102, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '540000', '西藏自治区', 187, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '610000', '陕西省', 1134, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '620000', '甘肃省', 612, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '630000', '青海省', 234, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '640000', '宁夏回族自治区', 298, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '650000', '新疆维吾尔自治区', 845, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '710000', '台湾省', 467, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '810000', '香港特别行政区', 198, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。'),
    ('competition_demo_v1', '820000', '澳门特别行政区', 67, true, '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。')
ON CONFLICT (simulation_version, province_code) DO UPDATE SET
    province_name = EXCLUDED.province_name,
    sample_count = EXCLUDED.sample_count,
    is_simulated = EXCLUDED.is_simulated,
    disclaimer = EXCLUDED.disclaimer;

COMMIT;