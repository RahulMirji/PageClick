const trendingItems = [
    {
        id: 1,
        title: 'AI Transforms Web Browsing',
        subtitle: 'New tools emerge',
        gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    },
    {
        id: 2,
        title: 'Chrome Extensions Hit 1B Users',
        subtitle: 'Record growth in 2026',
        gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    },
    {
        id: 3,
        title: 'React 20 Released',
        subtitle: 'Major performance gains',
        gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    },
]

function TrendingCards() {
    return (
        <div className="trending-section">
            <div className="trending-scroll">
                {trendingItems.map((item) => (
                    <div key={item.id} className="trending-card">
                        <div className="trending-card-preview" style={{ background: item.gradient }} />
                        <div className="trending-card-text">
                            <p className="trending-card-title">{item.title}</p>
                            <p className="trending-card-subtitle">{item.subtitle}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default TrendingCards
