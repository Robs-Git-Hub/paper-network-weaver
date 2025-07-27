import React from 'react';
import { Search, MousePointer, Network, BarChart3, Download, HelpCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { useNavigate } from 'react-router-dom';

const About: React.FC = () => {
  const navigate = useNavigate();

  const steps = [
    {
      icon: Search,
      title: "Search for a Paper",
      description: "Enter the full or partial name of a research paper in the search bar"
    },
    {
      icon: MousePointer,
      title: "Select Your Paper",
      description: "Choose the specific paper you want to analyze from the search results"
    },
    {
      icon: Network,
      title: "Discover Citations",
      description: "View papers that cited your selected work and their second-degree citations"
    },
    {
      icon: BarChart3,
      title: "Analyze the Data",
      description: "Explore citation patterns through table and network visualizations"
    },
    {
      icon: Download,
      title: "Export",
      description: "Export your citation data with a comprehensive table description file"
    }
  ];

  const faqs = [
    {
      question: "There is a Frictionless package description file in my export – what is it?",
      answer: "Frictionless is a data management framework for Python that provides functionality to describe, extract, validate, and transform tabular data. The file will help you import your exported data into a Python script for further analysis and processing. It also acts as a record of what each column in each table of the export is for."
    },
    {
      question: "Why can I only select papers with fewer than 200 citations?",
      answer: "ACE was designed to be a lightweight website that can process the papers of newer academics and researchers. If your paper has over 200 citations, congratulations! But it is larger than the site can efficiently process. If there is sufficient demand, I may redesign the site to handle larger citation networks."
    },
    {
      question: "How is this different to Connected Papers or Citation Gecko?",
      answer: "Those are great sites, but they don't show you all first- and second-degree citations—at least not easily. ACE is a simpler tool designed with that single purpose in mind."
    },
    {
      question: "Why can't I see some citations that Google Scholar shows?",
      answer: "The primary source of citation information is OpenAlex—credit and thanks to their excellent open-source service. I've found there are typically around 20% more citations on Google Scholar. However, fetching those would require web scraping, which would slow the site and incur costs. ACE is designed to be lightweight and free."
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="container flex h-14 items-center">
          <button 
            onClick={() => navigate('/')}
            className="text-lg font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            ACE
          </button>
        </div>
      </header>

      <div className="container max-w-4xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            About Academic Citation Explorer
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Discover the citation landscape around published research papers
          </p>
        </div>

        {/* About the Site */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">What is ACE?</h2>
          <Card>
            <CardContent className="pt-6">
              <p className="text-lg leading-relaxed text-muted-foreground">
                Academic Citation Explorer (ACE) is a research tool that helps academics, researchers, and students understand the citation landscape around a published paper. ACE lets you see the papers that cited a selected work, the papers that they in turn were cited by (aka second-degree citations) and the papers that were frequently cited alongside the selected work.
              </p>
              <p className="text-lg leading-relaxed text-muted-foreground mt-4">
                ACE was designed for those who want to see what impact their papers have had and connect with other academics or researchers in their field.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* How to Use */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">How to Use ACE</h2>
          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <Card key={index} className="transition-shadow hover:shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground mb-2">
                          {index + 1}. {step.title}
                        </h3>
                        <p className="text-muted-foreground leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <HelpCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-semibold text-foreground">Frequently Asked Questions</h2>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`}>
                    <AccordionTrigger className="text-left font-medium text-foreground">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent>
                      <p className="text-muted-foreground leading-relaxed">
                        {faq.answer}
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </section>

        {/* Created By Section */}
        <section className="mb-16">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <h2 className="text-2xl font-semibold text-foreground mb-4">Created By</h2>
              <p className="text-lg leading-relaxed text-muted-foreground mb-6">
                ACE was created by Robert Collett as a tool to track how his own work was used by others. Follow his work and connect via{' '}
                <a 
                  href="https://www.linkedin.com/in/robert-collett/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 underline font-medium"
                >
                  LinkedIn
                </a>.
              </p>
              <Button onClick={() => navigate('/')} className="bg-primary hover:bg-primary/90">
                Start Exploring
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default About;