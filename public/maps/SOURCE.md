# 中国省级地图数据说明

当前前端实际加载的地图文件为：

```text
public/maps/china-provinces.json
```

该文件已使用项目负责人提供的 GeoJSON 资料落地：

```text
E:\download\中华人民共和国.geojson
```

已校验内容：

- 格式为 `FeatureCollection`；
- 包含 35 个地图要素；
- 包含 34 个省级行政区和一个 `100000_JD` 特殊地图要素；
- 省级要素使用 `properties.adcode` 作为行政区编码；
- 省级要素使用 `properties.name` 作为省份名称；
- 几何类型为 `Polygon` 或 `MultiPolygon`；
- 行政区编码与诈骗案例统计服务中的省份编码保持一致。

前端通过 `/maps/china-provinces.json` 加载该文件，并使用 ECharts 5 的 `registerMap('china', geoJson)` 注册地图。

正式部署前仍需由项目负责人确认该地图资料的授权、版本、行政区边界和公开展示合规要求。后续如果替换地图文件，必须保持文件名和上述字段契约不变，并执行：

```powershell
npm run test:china-map
```