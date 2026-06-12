export function Skeleton({ w = "100%", h = 14, style }) {
  return <span className="skeleton" style={{ width: w, height: h, ...style }} />;
}

export function SkeletonRows({ cols = 4, rows = 5 }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}><Skeleton w={c === 0 ? "70%" : "50%"} /></td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div className="cards">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card">
          <Skeleton w="50%" h={10} style={{ marginBottom: 10 }} />
          <Skeleton w="35%" h={24} />
        </div>
      ))}
    </div>
  );
}
