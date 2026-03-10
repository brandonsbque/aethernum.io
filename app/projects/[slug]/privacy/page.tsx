import { allProjects } from "contentlayer/generated";

type Props = {
	params: {
		slug: string;
	};
};

export async function generateStaticParams(): Promise<Props["params"][]> {
	return allProjects
		.filter((p) => p.published)
		.map((p) => ({
			slug: p.slug,
		}));
}

export default function PrivacyPage() {
	return (
		<div className="bg-zinc-50 min-h-screen">
			<div className="px-4 py-12 mx-auto prose prose-zinc prose-quoteless">
				<h1>Privacy Policy</h1>
				<p>Privacy content coming soon...</p>
			</div>
		</div>
	);
}
