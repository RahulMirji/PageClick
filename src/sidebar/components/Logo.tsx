function Logo() {
    return (
        <div className="logo-centered">
            {/* React Atom Icon as Logo */}
            <svg className="logo-icon-large" viewBox="-11.5 -10.23174 23 20.46348" width="56" height="56">
                <circle cx="0" cy="0" r="2.05" fill="#61DAFB" />
                <g stroke="#61DAFB" strokeWidth="1" fill="none">
                    <ellipse rx="11" ry="4.2" />
                    <ellipse rx="11" ry="4.2" transform="rotate(60)" />
                    <ellipse rx="11" ry="4.2" transform="rotate(120)" />
                </g>
            </svg>
            <span className="logo-name">PageClick</span>
        </div>
    )
}

export default Logo
