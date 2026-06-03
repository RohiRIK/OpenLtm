"use client";

import { Card } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { useEffect, useRef, useState } from "react";

export default function AIThinkingBlock() {
const [scrollPosition, setScrollPosition] = useState(0);
const contentRef = useRef<HTMLDivElement>(null);
const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

const ThinkingContent = `Okay, first I need to understand what HextaUI is. It seems to be a UI library or framework, likely for web development. I should check the web results for any mentions of HextaUI.

Looking at the web results, I see that HextaUI is mentioned in several contexts. It's described as a collection of modern, responsive, and customizable UI components for Next.js. It seems to be designed to help developers build websites more efficiently.

I should look for more specific details. The results mention that HextaUI provides components that can be copied, adapted, and personalized. It also mentions that it's open-source and has a community of contributors.

I should also check if there are any specific features or benefits mentioned. The results talk about the components being responsive and customizable, which are important for modern web development. It also mentions that the components are designed to be production-ready.

I should consider if there are any drawbacks or limitations mentioned. The results don't seem to mention any significant drawbacks, but I should keep in mind that any library or framework will have its own set of trade-offs.

I should also consider the credibility of the sources. The results include mentions from GitHub, Product Hunt, and other development-related websites, which are generally reliable sources for information about software libraries.

Based on the information from the web results, I can conclude that HextaUI is a UI component library for Next.js that provides modern, responsive, and customizable components for building websites. It's open-source and has a community of contributors.

I should also consider if there are any related posts on X that might provide additional context or opinions. The posts on X mention HextaUI v2 being released, with features like a complete design system, primitive components, and ready-made blocks. This suggests that HextaUI is actively maintained and updated.

I should consider if there are any specific use cases or examples mentioned. The web results mention that HextaUI components can be used to build stunning websites effortlessly, and that they are suitable for production applications.

I should also consider if there are any comparisons to other similar libraries or frameworks. The results don't mention any direct comparisons, but I can infer that HextaUI is similar to other UI component libraries like Shadcn/UI, which is mentioned in one of the results.

Based on the information from the web results and the posts on X, I can conclude that HextaUI is a UI component library for Next.js that provides modern, responsive, and customizable components for building websites. It's open-source, actively maintained, and has a community of contributors.

I should consider if there are any specific instructions or guidelines for using HextaUI. The web results mention that components can be copied and pasted into projects, and that there is a CLI tool for installing components.

I should also consider if there are any specific requirements or dependencies mentioned. The web results mention that HextaUI is designed for Next.js, so it likely requires a Next.js project to use.

Based on the information from the web results and the posts on X, I can conclude that HextaUI is a UI component library for Next.js that provides modern, responsive, and customizable components for building websites. It's open-source, actively maintained, and has a community of contributors. Components can be copied and pasted into projects, and there is a CLI tool for installing components.

I should consider if there are any specific examples or demos available. The web results mention that there is a website for HextaUI, which likely includes examples and documentation.

I should also consider if there are any specific licensing or usage terms mentioned. The web results mention that HextaUI is open-source, but I should check the specific license to understand the terms of use.

Based on the information from the web results and the posts on X, I can conclude that HextaUI is a UI component library for Next.js that provides modern, responsive, and customizable components for building websites. It's open-source, actively maintained, and has a community of contributors. Components can be copied and pasted into projects, and there is a CLI tool for installing components. The library is designed to be production-ready and supports features like dark mode.

I should consider if there are any specific installation or setup instructions mentioned. The web results mention that there is a CLI tool for installing components, and that components can be copied and pasted into projects.

I should also consider if there are any specific customization options mentioned. The web results mention that components are customizable through props and Tailwind CSS classes.

Based on the information from the web results and the posts on X, I can conclude that HextaUI is a UI component library for Next.js that provides modern, responsive, and customizable components for building websites. It's open-source, actively maintained, and has a community of contributors. Components can be copied and pasted into projects, and there is a CLI tool for installing components. The library is designed to be production-ready and supports features like dark mode. Components are customizable through props and Tailwind CSS classes.

I should consider if there are any specific community or support resources mentioned. The web results mention that there is a GitHub repository and a community for support and discussions.

I should also consider if there are any specific contribution guidelines mentioned. The web results mention that contributions are welcome and that there are guidelines for contributing.

Based on the information from the web results and the posts on X, I can conclude that HextaUI is a UI component library for Next.js that provides modern, responsive, and customizable components for building websites. It's open-source, actively maintained, and has a community of contributors. Components can be copied and pasted into projects, and there is a CLI tool for installing components. The library is designed to be production-ready and supports features like dark mode. Components are customizable through props and Tailwind CSS classes. There is a GitHub repository and a community for support and discussions, and contributions are welcome.

I should consider if there are any specific version or release information mentioned. The posts on X mention that HextaUI v2 has been released, with features like a complete design system, primitive components, and ready-made blocks.

I should also consider if there are any specific future plans or roadmap mentioned. The web results mention that there is a roadmap for upcoming features and improvements.

Based on the information from the web results and the posts on X, I can conclude that HextaUI is a UI component library for Next.js that provides modern, responsive, and customizable components for building websites. It's open-source, actively maintained, and has a community of contributors. Components can be copied and pasted into projects, and there is a CLI tool for installing components. The library is designed to be production-ready and supports features like dark mode. Components are customizable through props and Tailwind CSS classes. There is a GitHub repository and a community for support and discussions, and contributions are welcome. The latest version, HextaUI v2, includes a complete design system, primitive components, and ready-made blocks, and there is a roadmap for future features and improvements.

I think I have enough information to provide a comprehensive answer.

HextaUI is a UI component library specifically designed for Next.js applications. It provides a collection of modern, responsive, and customizable UI components that developers can easily copy, adapt, and personalize to build professional and visually appealing web interfaces. The library is open-source, actively maintained, and supported by a community of contributors, making it a reliable choice for developers looking to streamline their development process.

Key Features and Benefits:

Component-Based: HextaUI offers a wide range of pre-built components, such as buttons, forms, and navigation elements, which can be directly copied and pasted into your Next.js project. This allows for rapid prototyping and development.

Customization: Components are highly adaptable through props and Tailwind CSS classes, enabling developers to modify styles and behavior without altering the underlying code. This flexibility ensures that the components can fit the unique design requirements of any project.

Responsive and Production-Ready: The components are designed to be fully responsive, ensuring compatibility across devices. They are also tested to be production-ready, making them suitable for real-world applications.

CLI Tool: HextaUI includes a CLI tool that simplifies the installation of components. Developers can use commands like npx hexta-ui add button to quickly add components to their projects.

Dark Mode Support: The library includes built-in support for dark mode, enhancing accessibility and user experience.

Community and Support: HextaUI has an active community on GitHub, where developers can report bugs, request features, and contribute to the project. There are also contribution guidelines for those interested in improving the library.

Recent Updates:

HextaUI v2 was recently released, introducing several new features: A complete design system, Over 40 primitive components, Ready-made blocks for faster development.

The library is actively maintained, with a roadmap for future features and improvements, ensuring it stays up-to-date with modern development practices.

Usage and Installation:

To use HextaUI, you need a Next.js project. Components can be installed via the CLI or by copying and pasting code from the HextaUI website, which includes examples and documentation. The library is free and open-source, making it accessible to developers of all levels.

Conclusion:

HextaUI is an excellent choice for developers seeking to build modern, responsive, and customizable web interfaces with minimal effort. Its component-based approach, combined with strong community support and regular updates, makes it a valuable tool for accelerating the development of Next.js applications.`;

const [timer, setTimer] = useState(0);

useEffect(() => {
  const timerInterval = setInterval(() => {
    setTimer((prev) => prev + 1);
  }, 1000);

  return () => {
    clearInterval(timerInterval);
  };
}, []);

useEffect(() => {
  if (contentRef.current) {
    const scrollHeight = contentRef.current.scrollHeight;
    const clientHeight = contentRef.current.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    scrollIntervalRef.current = setInterval(() => {
      setScrollPosition((prev) => {
        const newPosition = prev + 1;
        if (newPosition >= maxScroll) {
          return 0;
        }
        return newPosition;
      });
    }, 5);

    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }
}, []);

useEffect(() => {
  if (contentRef.current) {
    contentRef.current.scrollTop = scrollPosition;
  }
}, [scrollPosition]);

return (
  <>
    <div className="flex flex-col p-3 max-w-xl">
      <div className="flex items-center justify-start gap-2 mb-4">
        <Loader size={"sm"} />
        <p
          className="bg-[linear-gradient(110deg,#404040,35%,#fff,50%,#404040,75%,#404040)] bg-[length:200%_100%] bg-clip-text text-base text-transparent animate-[shimmer_5s_linear_infinite]"
          style={{
            animation: "shimmer 5s linear infinite",
          }}
        >
          HextaAI is thinking
        </p>
        <span className="text-sm text-muted-foreground">
          {timer}s
        </span>
        <style jsx>{`
          @keyframes shimmer {
            0% {
              background-position: 200% 0;
            }
            100% {
              background-position: -200% 0;
            }
          }
        `}</style>
      </div>
      <Card className="relative h-[150px] overflow-hidden bg-secondary p-2 rounded-card">
        {/* Top fade overlay */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b  from-30% from-secondary to-transparent z-10 pointer-events-none h-[80px]" />

        {/* Bottom fade overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-30%  from-secondary to-transparent z-10 pointer-events-none h-[80px]" />

        {/* Scrolling content */}
        <div
          ref={contentRef}
          className="h-full overflow-hidden p-4 text-secondary-foreground"
          style={{
            scrollBehavior: "auto",
          }}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {ThinkingContent}
          </p>
        </div>
      </Card>
    </div>
  </>
);
}